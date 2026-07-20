import { createHmac, timingSafeEqual } from 'crypto';
import { z } from 'zod';
// Note: SupabaseClient is the @supabase/supabase-js type, re-exported by the
// database workspace package so it resolves without a fresh install.
import type { SupabaseClient } from '@business-os-ai/database';
import type { PaymentStatus } from './types';

const RAZORPAY_API_BASE = 'https://api.razorpay.com/v1';
const MIN_EXPIRY_MINUTES = 15; // Razorpay's minimum for payment link expiry
const DEFAULT_EXPIRY_MINUTES = 60;

export interface RazorpayConfig {
  keyId: string;
  keySecret: string;
  webhookSecret?: string;
  supabase?: SupabaseClient;
}

export interface RazorpayPaymentLinkResult {
  paymentNumber: string;
  providerLinkId: string;
  url: string;
  status: string;
  expiresAt: string;
}

export interface RazorpayWebhookResult {
  event: string;
  handled: boolean;
  providerLinkId?: string;
  paymentStatus?: PaymentStatus;
  providerTransactionId?: string;
  /** The paid entity's id (an order id or a booking id) + its org, so the
   *  caller can send a confirmation on the customer's channel. */
  orderId?: string;
  organizationId?: string;
  /** True when a bookings row (travel/cab/maid) was confirmed by this event. */
  bookingConfirmed?: boolean;
}

const RazorpayLinkResponseSchema = z.object({
  id: z.string(),
  short_url: z.string(),
  status: z.string(),
  expire_by: z.number()
});

const RazorpayErrorSchema = z.object({
  error: z.object({
    description: z.string().optional()
  }).optional()
});

const RazorpayWebhookEventSchema = z.object({
  event: z.string(),
  payload: z.object({
    payment_link: z.object({
      entity: z.object({ id: z.string() })
    }).optional(),
    payment: z.object({
      entity: z.object({ id: z.string() })
    }).optional()
  }).optional()
});

export class RazorpayPaymentService {
  private readonly keyId: string;
  private readonly keySecret: string;
  private readonly webhookSecret?: string;
  private readonly supabase?: SupabaseClient;

  constructor(config: RazorpayConfig) {
    this.keyId = config.keyId;
    this.keySecret = config.keySecret;
    this.webhookSecret = config.webhookSecret;
    this.supabase = config.supabase;
  }

  public async createPaymentLink(params: {
    organizationId: string;
    orderId: string;
    amount: number;
    currency?: string;
    description?: string;
    customerName?: string;
    customerPhone?: string;
    callbackUrl?: string;
    expiresInMinutes?: number;
  }): Promise<RazorpayPaymentLinkResult> {
    const currency = params.currency ?? 'INR';
    const expiresInMinutes = Math.max(params.expiresInMinutes ?? DEFAULT_EXPIRY_MINUTES, MIN_EXPIRY_MINUTES);
    const expireBy = Math.floor(Date.now() / 1000) + expiresInMinutes * 60;
    const referenceId = `PAY-${Math.floor(100000 + Math.random() * 900000)}`;

    const body: Record<string, unknown> = {
      amount: Math.round(params.amount * 100), // rupees → paise
      currency,
      notify: { sms: false, email: false },
      expire_by: expireBy,
      reference_id: referenceId
    };
    if (params.description) {
      body.description = params.description;
    }
    if (params.customerName || params.customerPhone) {
      body.customer = {
        ...(params.customerName ? { name: params.customerName } : {}),
        ...(params.customerPhone ? { contact: params.customerPhone } : {})
      };
    }
    if (params.callbackUrl) {
      body.callback_url = params.callbackUrl;
      body.callback_method = 'get';
    }

    const auth = Buffer.from(`${this.keyId}:${this.keySecret}`).toString('base64');
    const response = await fetch(`${RAZORPAY_API_BASE}/payment_links`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });

    const json: unknown = await response.json().catch(() => ({}));

    if (!response.ok) {
      const parsedError = RazorpayErrorSchema.safeParse(json);
      const description = parsedError.success ? parsedError.data.error?.description : undefined;
      throw new Error(`Razorpay payment link creation failed: ${description ?? `HTTP ${response.status}`}`);
    }

    const link = RazorpayLinkResponseSchema.parse(json);
    const expiresAt = new Date(link.expire_by * 1000).toISOString();

    if (this.supabase) {
      const { error: insertError } = await this.supabase.from('payments').insert({
        organization_id: params.organizationId,
        order_id: params.orderId,
        payment_number: referenceId,
        provider: 'razorpay',
        provider_link_id: link.id,
        amount: params.amount,
        currency,
        status: 'pending',
        payment_link_url: link.short_url,
        expires_at: expiresAt
      });
      if (insertError) {
        throw new Error(`Failed to persist payment: ${insertError.message}`);
      }

      const { error: orderError } = await this.supabase
        .from('orders')
        .update({ status: 'pending_payment' })
        .eq('id', params.orderId)
        .eq('organization_id', params.organizationId);
      if (orderError) {
        throw new Error(`Failed to update order status: ${orderError.message}`);
      }
    }

    return {
      paymentNumber: referenceId,
      providerLinkId: link.id,
      url: link.short_url,
      status: link.status,
      expiresAt
    };
  }

  public verifyWebhookSignature(rawBody: string | Buffer, signature: string): boolean {
    if (!this.webhookSecret) {
      return false;
    }
    const expected = createHmac('sha256', this.webhookSecret).update(rawBody).digest('hex');
    const expectedBuffer = Buffer.from(expected, 'utf8');
    const signatureBuffer = Buffer.from(signature, 'utf8');
    if (expectedBuffer.length !== signatureBuffer.length) {
      return false;
    }
    return timingSafeEqual(expectedBuffer, signatureBuffer);
  }

  public async handleWebhookEvent(event: unknown): Promise<RazorpayWebhookResult> {
    const parsed = RazorpayWebhookEventSchema.safeParse(event);
    if (!parsed.success) {
      return { event: 'unknown', handled: false };
    }

    const eventName = parsed.data.event;
    const providerLinkId = parsed.data.payload?.payment_link?.entity.id;
    const providerTransactionId = parsed.data.payload?.payment?.entity.id;

    let paymentStatus: PaymentStatus | undefined;
    if (eventName === 'payment_link.paid') {
      paymentStatus = 'captured';
    } else if (eventName === 'payment_link.expired' || eventName === 'payment_link.cancelled') {
      paymentStatus = 'failed';
    }

    if (!paymentStatus || !providerLinkId) {
      return { event: eventName, handled: false };
    }

    const result: RazorpayWebhookResult = {
      event: eventName,
      handled: true,
      providerLinkId,
      paymentStatus
    };
    if (providerTransactionId) {
      result.providerTransactionId = providerTransactionId;
    }

    if (!this.supabase) {
      return result;
    }

    const paymentUpdate: Record<string, unknown> = { status: paymentStatus };
    if (paymentStatus === 'captured' && providerTransactionId) {
      paymentUpdate.provider_transaction_id = providerTransactionId;
    }

    const { error: paymentError } = await this.supabase
      .from('payments')
      .update(paymentUpdate)
      .eq('provider_link_id', providerLinkId);
    if (paymentError) {
      throw new Error(`Failed to update payment: ${paymentError.message}`);
    }

    if (paymentStatus === 'captured') {
      const { data: paymentRows, error: lookupError } = await this.supabase
        .from('payments')
        .select('order_id, organization_id')
        .eq('provider_link_id', providerLinkId);
      if (lookupError) {
        throw new Error(`Failed to look up payment: ${lookupError.message}`);
      }

      const payment = paymentRows?.[0] as { order_id?: string; organization_id?: string } | undefined;
      if (payment?.order_id && payment.organization_id) {
        result.orderId = payment.order_id;
        result.organizationId = payment.organization_id;
        // A payment's order_id is either an orders row (product purchase) or a
        // bookings row (travel/cab/maid). Try both — only one will match.
        const { error: orderError } = await this.supabase
          .from('orders')
          .update({ status: 'paid' })
          .eq('id', payment.order_id)
          .eq('organization_id', payment.organization_id);
        if (orderError) {
          throw new Error(`Failed to update order status: ${orderError.message}`);
        }
        const { data: bookingRows } = await this.supabase
          .from('bookings')
          .update({ status: 'confirmed' })
          .eq('id', payment.order_id)
          .eq('organization_id', payment.organization_id)
          .select('id');
        if (bookingRows && bookingRows.length > 0) result.bookingConfirmed = true;
      }
    }

    return result;
  }
}
