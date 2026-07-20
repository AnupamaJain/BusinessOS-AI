import { describe, it, expect, vi, afterEach } from 'vitest';
import { createHmac } from 'node:crypto';
import {
  StripeBillingService,
  createBillingServiceFromEnv,
  PLANS
} from './billing';

describe('StripeBillingService.createCheckoutSession', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('POSTs to the Checkout Sessions API with Bearer auth + urlencoded body, returning the url on 200', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      json: async () => ({ id: 'cs_test_123', url: 'https://checkout.stripe.com/c/pay/cs_test_123' })
    });
    vi.stubGlobal('fetch', fetchMock);

    const service = new StripeBillingService({ secretKey: 'sk_test_key' });
    const result = await service.createCheckoutSession({
      organizationId: 'org_42',
      priceId: 'price_abc',
      customerEmail: 'owner@smb.com',
      successUrl: 'https://app.saarthi.one/billing/success',
      cancelUrl: 'https://app.saarthi.one/billing/cancel'
    });

    expect(result).toEqual({
      ok: true,
      sessionId: 'cs_test_123',
      url: 'https://checkout.stripe.com/c/pay/cs_test_123'
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.stripe.com/v1/checkout/sessions');
    expect(init.method).toBe('POST');

    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer sk_test_key');
    expect(headers['Content-Type']).toBe('application/x-www-form-urlencoded');

    const params = new URLSearchParams(init.body as string);
    expect(params.get('mode')).toBe('subscription');
    expect(params.get('line_items[0][price]')).toBe('price_abc');
    expect(params.get('line_items[0][quantity]')).toBe('1');
    expect(params.get('success_url')).toBe('https://app.saarthi.one/billing/success');
    expect(params.get('cancel_url')).toBe('https://app.saarthi.one/billing/cancel');
    expect(params.get('client_reference_id')).toBe('org_42');
    expect(params.get('customer_email')).toBe('owner@smb.com');
    expect(params.get('metadata[organization_id]')).toBe('org_42');
  });

  it('omits customer_email when not provided', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      json: async () => ({ id: 'cs_1', url: 'https://x' })
    });
    vi.stubGlobal('fetch', fetchMock);

    const service = new StripeBillingService({ secretKey: 'sk' });
    await service.createCheckoutSession({
      organizationId: 'org_1',
      priceId: 'price_1',
      successUrl: 'https://s',
      cancelUrl: 'https://c'
    });

    const params = new URLSearchParams(
      (fetchMock.mock.calls[0]![1] as RequestInit).body as string
    );
    expect(params.has('customer_email')).toBe(false);
  });

  it('returns { skipped: true } and does not call fetch when no secret key is set', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const service = new StripeBillingService({});
    const result = await service.createCheckoutSession({
      organizationId: 'org_1',
      priceId: 'price_1',
      successUrl: 'https://s',
      cancelUrl: 'https://c'
    });

    expect(result).toEqual({
      ok: false,
      skipped: true,
      error: 'STRIPE_SECRET_KEY not configured'
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns the Stripe error.message on a non-2xx response', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 400,
      json: async () => ({ error: { message: 'No such price: price_bad' } })
    });
    vi.stubGlobal('fetch', fetchMock);

    const service = new StripeBillingService({ secretKey: 'sk' });
    const result = await service.createCheckoutSession({
      organizationId: 'org_1',
      priceId: 'price_bad',
      successUrl: 'https://s',
      cancelUrl: 'https://c'
    });

    expect(result.ok).toBe(false);
    expect(result.skipped).toBeUndefined();
    expect(result.error).toBe('No such price: price_bad');
  });
});

describe('StripeBillingService.createBillingPortalSession', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('POSTs customer + return_url and returns the portal url', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      json: async () => ({ url: 'https://billing.stripe.com/session/abc' })
    });
    vi.stubGlobal('fetch', fetchMock);

    const service = new StripeBillingService({ secretKey: 'sk' });
    const result = await service.createBillingPortalSession({
      customerId: 'cus_123',
      returnUrl: 'https://app.saarthi.one/billing'
    });

    expect(result).toEqual({ ok: true, url: 'https://billing.stripe.com/session/abc' });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.stripe.com/v1/billing_portal/sessions');
    const params = new URLSearchParams(init.body as string);
    expect(params.get('customer')).toBe('cus_123');
    expect(params.get('return_url')).toBe('https://app.saarthi.one/billing');
  });

  it('returns { skipped: true } without a secret key', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const service = new StripeBillingService({});
    const result = await service.createBillingPortalSession({
      customerId: 'cus_1',
      returnUrl: 'https://r'
    });

    expect(result).toEqual({
      ok: false,
      skipped: true,
      error: 'STRIPE_SECRET_KEY not configured'
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('StripeBillingService.verifyWebhookSignature', () => {
  const webhookSecret = 'whsec_test_secret';
  const payload = '{"id":"evt_1","type":"checkout.session.completed"}';
  const timestamp = '1700000000';

  function sign(t: string, body: string, secret: string): string {
    return createHmac('sha256', secret).update(`${t}.${body}`, 'utf8').digest('hex');
  }

  it('accepts a correctly computed signature', () => {
    const service = new StripeBillingService({ webhookSecret });
    const v1 = sign(timestamp, payload, webhookSecret);
    const header = `t=${timestamp},v1=${v1}`;
    expect(service.verifyWebhookSignature(payload, header)).toBe(true);
  });

  it('accepts a Buffer payload', () => {
    const service = new StripeBillingService({ webhookSecret });
    const v1 = sign(timestamp, payload, webhookSecret);
    const header = `t=${timestamp},v1=${v1}`;
    expect(service.verifyWebhookSignature(Buffer.from(payload, 'utf8'), header)).toBe(true);
  });

  it('rejects a tampered signature', () => {
    const service = new StripeBillingService({ webhookSecret });
    const v1 = sign(timestamp, payload, webhookSecret);
    const header = `t=${timestamp},v1=${v1}`;
    // tamper with the payload
    expect(service.verifyWebhookSignature(payload + 'x', header)).toBe(false);
  });

  it('rejects a signature made with the wrong secret', () => {
    const service = new StripeBillingService({ webhookSecret });
    const v1 = sign(timestamp, payload, 'whsec_wrong');
    const header = `t=${timestamp},v1=${v1}`;
    expect(service.verifyWebhookSignature(payload, header)).toBe(false);
  });

  it('returns false when the webhook secret is missing', () => {
    const service = new StripeBillingService({});
    const v1 = sign(timestamp, payload, webhookSecret);
    expect(service.verifyWebhookSignature(payload, `t=${timestamp},v1=${v1}`)).toBe(false);
  });

  it('returns false for a malformed header', () => {
    const service = new StripeBillingService({ webhookSecret });
    expect(service.verifyWebhookSignature(payload, 'not-a-valid-header')).toBe(false);
    expect(service.verifyWebhookSignature(payload, `t=${timestamp}`)).toBe(false);
    expect(service.verifyWebhookSignature(payload, '')).toBe(false);
  });
});

describe('StripeBillingService.parseWebhookEvent', () => {
  it('maps checkout.session.completed → organizationId from client_reference_id', async () => {
    const service = new StripeBillingService({});
    const raw = JSON.stringify({
      type: 'checkout.session.completed',
      data: {
        object: {
          client_reference_id: 'org_99',
          customer: 'cus_555',
          subscription: 'sub_777',
          status: 'complete'
        }
      }
    });

    const event = await service.parseWebhookEvent(raw);
    expect(event).toEqual({
      type: 'checkout.session.completed',
      organizationId: 'org_99',
      customerId: 'cus_555',
      subscriptionId: 'sub_777',
      status: 'complete'
    });
  });

  it('falls back to metadata.organization_id and uses object.id as subscription id for subscription events', async () => {
    const service = new StripeBillingService({});
    const raw = JSON.stringify({
      type: 'customer.subscription.updated',
      data: {
        object: {
          id: 'sub_abc',
          customer: 'cus_1',
          status: 'active',
          metadata: { organization_id: 'org_meta' }
        }
      }
    });

    const event = await service.parseWebhookEvent(raw);
    expect(event).toEqual({
      type: 'customer.subscription.updated',
      organizationId: 'org_meta',
      customerId: 'cus_1',
      subscriptionId: 'sub_abc',
      status: 'active'
    });
  });

  it('returns null for an unknown event type', async () => {
    const service = new StripeBillingService({});
    const raw = JSON.stringify({ type: 'invoice.paid', data: { object: {} } });
    expect(await service.parseWebhookEvent(raw)).toBeNull();
  });

  it('returns null for malformed JSON without throwing', async () => {
    const service = new StripeBillingService({});
    expect(await service.parseWebhookEvent('{not json')).toBeNull();
  });
});

describe('createBillingServiceFromEnv', () => {
  it('reads STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET', () => {
    expect(createBillingServiceFromEnv({}).isConfigured).toBe(false);
    expect(createBillingServiceFromEnv({ STRIPE_SECRET_KEY: 'sk' }).isConfigured).toBe(true);
  });
});

describe('PLANS', () => {
  it('exposes the three subscription tiers with price env vars', () => {
    expect(PLANS.map((p) => p.id)).toEqual(['starter', 'growth', 'scale']);
    expect(PLANS.map((p) => p.priceEnvVar)).toEqual([
      'STRIPE_PRICE_STARTER',
      'STRIPE_PRICE_GROWTH',
      'STRIPE_PRICE_SCALE'
    ]);
    expect(PLANS.find((p) => p.id === 'growth')?.monthly).toBe('₹2,999');
  });
});
