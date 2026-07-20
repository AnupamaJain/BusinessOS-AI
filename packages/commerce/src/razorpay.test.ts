import { describe, it, expect, vi, afterEach } from 'vitest';
import { createHmac } from 'node:crypto';
import type { SupabaseClient } from '@business-os-ai/database';
import { RazorpayPaymentService } from './razorpay';

const ORG_A = '11111111-1111-1111-1111-111111111111';
const ORDER_ID = '44444444-4444-4444-4444-444444444444';

interface RecordedCall {
  table: string;
  op: 'insert' | 'update' | 'select';
  values?: unknown;
  filters: Array<[string, unknown]>;
}

function createFakeSupabase(selectRows: unknown[] = [], bookingUpdateRows: unknown[] = []) {
  const calls: RecordedCall[] = [];

  const client = {
    from(table: string) {
      return {
        insert(values: unknown) {
          calls.push({ table, op: 'insert', values, filters: [] });
          return Promise.resolve({ error: null });
        },
        update(values: unknown) {
          const call: RecordedCall = { table, op: 'update', values, filters: [] };
          calls.push(call);
          const builder = {
            eq(column: string, value: unknown) {
              call.filters.push([column, value]);
              return builder;
            },
            // update(...).eq(...).select(...) — used to detect whether a booking
            // row matched; return no rows so order-payment tests are unaffected.
            select(_columns: string) {
              const rows = table === 'bookings' ? bookingUpdateRows : [];
              return { then(resolve: (value: { data: unknown[]; error: null }) => void) { resolve({ data: rows, error: null }); } };
            },
            then(resolve: (value: { error: null }) => void) {
              resolve({ error: null });
            }
          };
          return builder;
        },
        select(columns: string) {
          const call: RecordedCall = { table, op: 'select', values: columns, filters: [] };
          calls.push(call);
          const builder = {
            eq(column: string, value: unknown) {
              call.filters.push([column, value]);
              return builder;
            },
            then(resolve: (value: { data: unknown[]; error: null }) => void) {
              resolve({ data: selectRows, error: null });
            }
          };
          return builder;
        }
      };
    }
  };

  return { client: client as unknown as SupabaseClient, calls };
}

describe('RazorpayPaymentService', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('createPaymentLink', () => {
    it('creates a payment link via the Razorpay API', async () => {
      const expireBy = Math.floor(Date.now() / 1000) + 3600;
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          id: 'plink_test123',
          short_url: 'https://rzp.io/l/abc123',
          status: 'created',
          expire_by: expireBy
        })
      });
      vi.stubGlobal('fetch', fetchMock);

      const service = new RazorpayPaymentService({
        keyId: 'rzp_test_key',
        keySecret: 'test_secret'
      });

      const result = await service.createPaymentLink({
        organizationId: ORG_A,
        orderId: ORDER_ID,
        amount: 499.5,
        description: 'Bali Package',
        customerName: 'Priya',
        customerPhone: '+919876543210'
      });

      expect(result.providerLinkId).toBe('plink_test123');
      expect(result.url).toBe('https://rzp.io/l/abc123');
      expect(result.status).toBe('created');
      expect(result.paymentNumber).toMatch(/^PAY-\d{6}$/);
      expect(result.expiresAt).toBe(new Date(expireBy * 1000).toISOString());

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://api.razorpay.com/v1/payment_links');
      expect(init.method).toBe('POST');
      const headers = init.headers as Record<string, string>;
      const expectedAuth = Buffer.from('rzp_test_key:test_secret').toString('base64');
      expect(headers.Authorization).toBe(`Basic ${expectedAuth}`);

      const body = JSON.parse(init.body as string);
      expect(body.amount).toBe(49950); // rupees converted to paise
      expect(body.currency).toBe('INR');
      expect(body.description).toBe('Bali Package');
      expect(body.customer).toEqual({ name: 'Priya', contact: '+919876543210' });
      expect(body.notify).toEqual({ sms: false, email: false });
      expect(body.reference_id).toBe(result.paymentNumber);
      expect(body.expire_by).toBeGreaterThan(Math.floor(Date.now() / 1000));
    });

    it('clamps expiry to the Razorpay 15-minute minimum', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          id: 'plink_test123',
          short_url: 'https://rzp.io/l/abc123',
          status: 'created',
          expire_by: Math.floor(Date.now() / 1000) + 900
        })
      });
      vi.stubGlobal('fetch', fetchMock);

      const service = new RazorpayPaymentService({
        keyId: 'rzp_test_key',
        keySecret: 'test_secret'
      });

      await service.createPaymentLink({
        organizationId: ORG_A,
        orderId: ORDER_ID,
        amount: 100,
        expiresInMinutes: 5
      });

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string);
      const minimumExpireBy = Math.floor(Date.now() / 1000) + 14 * 60;
      expect(body.expire_by).toBeGreaterThanOrEqual(minimumExpireBy);
    });

    it('throws with the Razorpay error description on failure', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({
          error: { code: 'BAD_REQUEST_ERROR', description: 'amount must be at least 100' }
        })
      });
      vi.stubGlobal('fetch', fetchMock);

      const service = new RazorpayPaymentService({
        keyId: 'rzp_test_key',
        keySecret: 'test_secret'
      });

      await expect(
        service.createPaymentLink({ organizationId: ORG_A, orderId: ORDER_ID, amount: 0.5 })
      ).rejects.toThrow('amount must be at least 100');
    });

    it('persists the payment and marks the order pending_payment when supabase is provided', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          id: 'plink_test123',
          short_url: 'https://rzp.io/l/abc123',
          status: 'created',
          expire_by: Math.floor(Date.now() / 1000) + 3600
        })
      });
      vi.stubGlobal('fetch', fetchMock);

      const { client, calls } = createFakeSupabase();
      const service = new RazorpayPaymentService({
        keyId: 'rzp_test_key',
        keySecret: 'test_secret',
        supabase: client
      });

      const result = await service.createPaymentLink({
        organizationId: ORG_A,
        orderId: ORDER_ID,
        amount: 499.5
      });

      const insertCall = calls.find(c => c.table === 'payments' && c.op === 'insert');
      expect(insertCall).toBeDefined();
      expect(insertCall?.values).toMatchObject({
        organization_id: ORG_A,
        order_id: ORDER_ID,
        payment_number: result.paymentNumber,
        provider: 'razorpay',
        provider_link_id: 'plink_test123',
        amount: 499.5,
        currency: 'INR',
        status: 'pending',
        payment_link_url: 'https://rzp.io/l/abc123'
      });

      const orderCall = calls.find(c => c.table === 'orders' && c.op === 'update');
      expect(orderCall?.values).toEqual({ status: 'pending_payment' });
      expect(orderCall?.filters).toEqual([
        ['id', ORDER_ID],
        ['organization_id', ORG_A]
      ]);
    });
  });

  describe('verifyWebhookSignature', () => {
    it('accepts a valid HMAC-SHA256 signature', () => {
      const service = new RazorpayPaymentService({
        keyId: 'rzp_test_key',
        keySecret: 'test_secret',
        webhookSecret: 'whsec_test'
      });

      const rawBody = JSON.stringify({ event: 'payment_link.paid' });
      const signature = createHmac('sha256', 'whsec_test').update(rawBody).digest('hex');

      expect(service.verifyWebhookSignature(rawBody, signature)).toBe(true);
    });

    it('rejects a tampered signature', () => {
      const service = new RazorpayPaymentService({
        keyId: 'rzp_test_key',
        keySecret: 'test_secret',
        webhookSecret: 'whsec_test'
      });

      const rawBody = JSON.stringify({ event: 'payment_link.paid' });
      const signature = createHmac('sha256', 'wrong_secret').update(rawBody).digest('hex');

      expect(service.verifyWebhookSignature(rawBody, signature)).toBe(false);
      expect(service.verifyWebhookSignature(rawBody, 'not-a-hex-signature')).toBe(false);
    });

    it('returns false when no webhook secret is configured', () => {
      const service = new RazorpayPaymentService({
        keyId: 'rzp_test_key',
        keySecret: 'test_secret'
      });

      const rawBody = '{}';
      const signature = createHmac('sha256', 'whsec_test').update(rawBody).digest('hex');
      expect(service.verifyWebhookSignature(rawBody, signature)).toBe(false);
    });
  });

  describe('handleWebhookEvent', () => {
    const paidEvent = {
      event: 'payment_link.paid',
      payload: {
        payment_link: { entity: { id: 'plink_test123' } },
        payment: { entity: { id: 'pay_txn456' } }
      }
    };

    it('marks the payment captured and the order paid on payment_link.paid', async () => {
      const { client, calls } = createFakeSupabase([
        { order_id: ORDER_ID, organization_id: ORG_A }
      ]);
      const service = new RazorpayPaymentService({
        keyId: 'rzp_test_key',
        keySecret: 'test_secret',
        supabase: client
      });

      const result = await service.handleWebhookEvent(paidEvent);

      expect(result.handled).toBe(true);
      expect(result.paymentStatus).toBe('captured');
      expect(result.providerLinkId).toBe('plink_test123');
      expect(result.providerTransactionId).toBe('pay_txn456');

      const paymentUpdate = calls.find(c => c.table === 'payments' && c.op === 'update');
      expect(paymentUpdate?.values).toEqual({
        status: 'captured',
        provider_transaction_id: 'pay_txn456'
      });
      expect(paymentUpdate?.filters).toEqual([['provider_link_id', 'plink_test123']]);

      const orderUpdate = calls.find(c => c.table === 'orders' && c.op === 'update');
      expect(orderUpdate?.values).toEqual({ status: 'paid' });
      expect(orderUpdate?.filters).toEqual([
        ['id', ORDER_ID],
        ['organization_id', ORG_A]
      ]);
    });

    it('confirms a booking and flags bookingConfirmed when the paid entity is a booking', async () => {
      const { client, calls } = createFakeSupabase(
        [{ order_id: ORDER_ID, organization_id: ORG_A }],
        [{ id: ORDER_ID }], // the bookings update matched a row
      );
      const service = new RazorpayPaymentService({ keyId: 'rzp_test_key', keySecret: 'test_secret', supabase: client });

      const result = await service.handleWebhookEvent(paidEvent);

      expect(result.bookingConfirmed).toBe(true);
      expect(result.orderId).toBe(ORDER_ID);
      expect(result.organizationId).toBe(ORG_A);
      const bookingUpdate = calls.find(c => c.table === 'bookings' && c.op === 'update');
      expect(bookingUpdate?.values).toEqual({ status: 'confirmed' });
    });

    it('marks the payment failed on payment_link.expired', async () => {
      const { client, calls } = createFakeSupabase();
      const service = new RazorpayPaymentService({
        keyId: 'rzp_test_key',
        keySecret: 'test_secret',
        supabase: client
      });

      const result = await service.handleWebhookEvent({
        event: 'payment_link.expired',
        payload: { payment_link: { entity: { id: 'plink_test123' } } }
      });

      expect(result.handled).toBe(true);
      expect(result.paymentStatus).toBe('failed');

      const paymentUpdate = calls.find(c => c.table === 'payments' && c.op === 'update');
      expect(paymentUpdate?.values).toEqual({ status: 'failed' });
      expect(paymentUpdate?.filters).toEqual([['provider_link_id', 'plink_test123']]);
      expect(calls.some(c => c.table === 'orders')).toBe(false);
    });

    it('ignores unknown events without touching the database', async () => {
      const { client, calls } = createFakeSupabase();
      const service = new RazorpayPaymentService({
        keyId: 'rzp_test_key',
        keySecret: 'test_secret',
        supabase: client
      });

      const result = await service.handleWebhookEvent({ event: 'invoice.paid', payload: {} });
      expect(result.handled).toBe(false);
      expect(calls.length).toBe(0);

      const malformed = await service.handleWebhookEvent('not-an-event');
      expect(malformed.handled).toBe(false);
    });

    it('returns the parsed result without persistence when no supabase client is set', async () => {
      const service = new RazorpayPaymentService({
        keyId: 'rzp_test_key',
        keySecret: 'test_secret'
      });

      const result = await service.handleWebhookEvent(paidEvent);
      expect(result.handled).toBe(true);
      expect(result.paymentStatus).toBe('captured');
      expect(result.providerLinkId).toBe('plink_test123');
    });
  });
});
