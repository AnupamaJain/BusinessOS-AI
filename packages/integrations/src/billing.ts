/**
 * Stripe platform billing via the Stripe HTTP API.
 *
 * Charges the SMBs who use SaarthiOne — subscription plans (Checkout Sessions),
 * the customer billing portal, and inbound webhook handling.
 *
 * Pure `fetch` — no Stripe SDK dependency. Degrades gracefully when no secret
 * key is configured: request methods return a clear "skipped" result rather
 * than throwing, so callers can run without Stripe credentials in dev/test.
 * Webhook signatures are verified with `node:crypto` (HMAC-SHA256, timing-safe).
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

export interface BillingServiceConfig {
  secretKey?: string;
  webhookSecret?: string;
}

export interface CreateCheckoutSessionParams {
  organizationId: string;
  priceId: string;
  customerEmail?: string;
  successUrl: string;
  cancelUrl: string;
}

export interface CreateCheckoutSessionResult {
  ok: boolean;
  url?: string;
  sessionId?: string;
  error?: string;
  skipped?: boolean;
}

export interface CreateBillingPortalSessionParams {
  customerId: string;
  returnUrl: string;
}

export interface CreateBillingPortalSessionResult {
  ok: boolean;
  url?: string;
  error?: string;
  skipped?: boolean;
}

export interface ParsedWebhookEvent {
  type: string;
  organizationId?: string;
  customerId?: string;
  subscriptionId?: string;
  status?: string;
}

export interface Plan {
  id: string;
  name: string;
  priceEnvVar: string;
  monthly: string;
}

const STRIPE_API_BASE = 'https://api.stripe.com';

/** Subscription plans offered to SaarthiOne SMB customers. */
export const PLANS: readonly Plan[] = [
  { id: 'starter', name: 'Starter', priceEnvVar: 'STRIPE_PRICE_STARTER', monthly: '₹999' },
  { id: 'growth', name: 'Growth', priceEnvVar: 'STRIPE_PRICE_GROWTH', monthly: '₹2,999' },
  { id: 'scale', name: 'Scale', priceEnvVar: 'STRIPE_PRICE_SCALE', monthly: '₹7,999' }
] as const;

/** Stripe error envelope: `{ error: { message } }`. */
interface StripeError {
  error?: { message?: string };
}

const WEBHOOK_EVENT_TYPES = new Set([
  'checkout.session.completed',
  'customer.subscription.updated',
  'customer.subscription.deleted'
]);

export class StripeBillingService {
  private readonly secretKey?: string;
  private readonly webhookSecret?: string;

  constructor(config: BillingServiceConfig = {}) {
    this.secretKey = config.secretKey;
    this.webhookSecret = config.webhookSecret;
  }

  /** True when a secret key is present and Stripe calls can actually be made. */
  get isConfigured(): boolean {
    return Boolean(this.secretKey);
  }

  /**
   * POST a form-encoded request to the Stripe API and return the parsed body,
   * or a normalized error result. Never throws.
   */
  private async postForm(
    path: string,
    body: URLSearchParams
  ): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; error: string }> {
    let response: Response;
    try {
      response = await fetch(`${STRIPE_API_BASE}${path}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.secretKey}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: body.toString()
      });
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }

    if (response.status >= 200 && response.status < 300) {
      try {
        const data = (await response.json()) as Record<string, unknown>;
        return { ok: true, data };
      } catch (err) {
        return { ok: false, error: (err as Error).message };
      }
    }

    let error = `Stripe responded with status ${response.status}`;
    try {
      const payload = (await response.json()) as StripeError;
      if (payload?.error?.message) error = payload.error.message;
    } catch {
      // keep the status-based message
    }
    return { ok: false, error };
  }

  async createCheckoutSession(
    params: CreateCheckoutSessionParams
  ): Promise<CreateCheckoutSessionResult> {
    if (!this.secretKey) {
      return { ok: false, skipped: true, error: 'STRIPE_SECRET_KEY not configured' };
    }

    const body = new URLSearchParams();
    body.set('mode', 'subscription');
    body.set('line_items[0][price]', params.priceId);
    body.set('line_items[0][quantity]', '1');
    body.set('success_url', params.successUrl);
    body.set('cancel_url', params.cancelUrl);
    body.set('client_reference_id', params.organizationId);
    if (params.customerEmail) {
      body.set('customer_email', params.customerEmail);
    }
    body.set('metadata[organization_id]', params.organizationId);

    const result = await this.postForm('/v1/checkout/sessions', body);
    if (!result.ok) {
      return { ok: false, error: result.error };
    }

    const { id, url } = result.data as { id?: string; url?: string };
    return { ok: true, sessionId: id, url };
  }

  async createBillingPortalSession(
    params: CreateBillingPortalSessionParams
  ): Promise<CreateBillingPortalSessionResult> {
    if (!this.secretKey) {
      return { ok: false, skipped: true, error: 'STRIPE_SECRET_KEY not configured' };
    }

    const body = new URLSearchParams();
    body.set('customer', params.customerId);
    body.set('return_url', params.returnUrl);

    const result = await this.postForm('/v1/billing_portal/sessions', body);
    if (!result.ok) {
      return { ok: false, error: result.error };
    }

    const { url } = result.data as { url?: string };
    return { ok: true, url };
  }

  /**
   * Verify a Stripe webhook signature.
   *
   * The `Stripe-Signature` header looks like `t=timestamp,v1=signature`. We
   * compute the HMAC-SHA256 hex of `${t}.${payload}` keyed by the webhook
   * secret and timing-safe compare it to the header's v1 value. Returns false
   * if the secret is missing or the header is malformed.
   */
  verifyWebhookSignature(payload: string | Buffer, sigHeader: string): boolean {
    if (!this.webhookSecret || !sigHeader) return false;

    let timestamp: string | undefined;
    let signature: string | undefined;
    for (const part of sigHeader.split(',')) {
      const eq = part.indexOf('=');
      if (eq === -1) continue;
      const key = part.slice(0, eq).trim();
      const value = part.slice(eq + 1).trim();
      if (key === 't') timestamp = value;
      else if (key === 'v1') signature = value;
    }

    if (!timestamp || !signature) return false;

    const payloadStr = typeof payload === 'string' ? payload : payload.toString('utf8');
    const expected = createHmac('sha256', this.webhookSecret)
      .update(`${timestamp}.${payloadStr}`, 'utf8')
      .digest('hex');

    const expectedBuf = Buffer.from(expected, 'utf8');
    const actualBuf = Buffer.from(signature, 'utf8');
    if (expectedBuf.length !== actualBuf.length) return false;

    try {
      return timingSafeEqual(expectedBuf, actualBuf);
    } catch {
      return false;
    }
  }

  /**
   * Parse a raw webhook body into a normalized event. Returns null for unknown
   * or malformed events. Never throws. Signature verification is separate —
   * call {@link verifyWebhookSignature} first.
   */
  async parseWebhookEvent(rawBody: string): Promise<ParsedWebhookEvent | null> {
    let event: unknown;
    try {
      event = JSON.parse(rawBody);
    } catch {
      return null;
    }

    if (!event || typeof event !== 'object') return null;
    const { type, data } = event as {
      type?: unknown;
      data?: { object?: Record<string, unknown> };
    };

    if (typeof type !== 'string' || !WEBHOOK_EVENT_TYPES.has(type)) return null;

    const obj = data?.object;
    if (!obj || typeof obj !== 'object') return null;

    const metadata = obj.metadata as Record<string, unknown> | undefined;
    const organizationId =
      asString(obj.client_reference_id) ?? asString(metadata?.organization_id);

    // On checkout.session.completed the object is a Session whose `subscription`
    // holds the subscription id; on subscription events the object *is* the
    // subscription, so its own `id` is the subscription id.
    const subscriptionId =
      asString(obj.subscription) ??
      (type === 'checkout.session.completed' ? undefined : asString(obj.id));

    return {
      type,
      organizationId,
      customerId: asString(obj.customer),
      subscriptionId,
      status: asString(obj.status)
    };
  }
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * Create a {@link StripeBillingService} from environment variables.
 * Reads STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET.
 */
export function createBillingServiceFromEnv(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env
): StripeBillingService {
  return new StripeBillingService({
    secretKey: env.STRIPE_SECRET_KEY,
    webhookSecret: env.STRIPE_WEBHOOK_SECRET
  });
}
