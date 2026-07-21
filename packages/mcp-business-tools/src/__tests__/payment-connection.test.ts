import { describe, it, expect, beforeEach } from 'vitest';
import { ToolDataStore } from '../tools';
import { SecretBox } from '../crypto';

const ORG = '11111111-1111-1111-1111-111111111111';

describe('payment connections (ToolDataStore)', () => {
  let store: ToolDataStore;
  beforeEach(() => {
    store = new ToolDataStore();
  });

  it('returns null when no connection exists', async () => {
    expect(await store.getPaymentConnection(ORG)).toBeNull();
  });

  it('round-trips keyId / keySecret / webhookSecret', async () => {
    await store.savePaymentConnection(ORG, {
      keyId: 'rzp_test_ABC123',
      keySecret: 'super-secret-value',
      webhookSecret: 'whsec-123',
    });
    const conn = await store.getPaymentConnection(ORG);
    expect(conn).not.toBeNull();
    expect(conn!.organizationId).toBe(ORG);
    expect(conn!.provider).toBe('razorpay');
    expect(conn!.keyId).toBe('rzp_test_ABC123');
    expect(conn!.keySecret).toBe('super-secret-value');
    expect(conn!.webhookSecret).toBe('whsec-123');
    expect(conn!.status).toBe('active');
  });

  it("derives mode 'test' from the rzp_test_ prefix", async () => {
    await store.savePaymentConnection(ORG, { keyId: 'rzp_test_XYZ', keySecret: 's' });
    expect((await store.getPaymentConnection(ORG))!.mode).toBe('test');
  });

  it("derives mode 'live' from the rzp_live_ prefix", async () => {
    await store.savePaymentConnection(ORG, { keyId: 'rzp_live_XYZ', keySecret: 's' });
    expect((await store.getPaymentConnection(ORG))!.mode).toBe('live');
  });

  it('falls back to the supplied mode for a non-prefixed key', async () => {
    await store.savePaymentConnection(ORG, { keyId: 'custom_key', keySecret: 's', mode: 'live' });
    expect((await store.getPaymentConnection(ORG))!.mode).toBe('live');
  });

  it('upserts in place (one connection per org)', async () => {
    await store.savePaymentConnection(ORG, { keyId: 'rzp_test_A', keySecret: 'first' });
    await store.savePaymentConnection(ORG, { keyId: 'rzp_live_B', keySecret: 'second' });
    const conn = await store.getPaymentConnection(ORG);
    expect(store.paymentConnections).toHaveLength(1);
    expect(conn!.keyId).toBe('rzp_live_B');
    expect(conn!.keySecret).toBe('second');
    expect(conn!.mode).toBe('live');
  });
});

describe('SecretBox round-trips a payment secret', () => {
  it('encrypts then decrypts back to the original secret', () => {
    const box = new SecretBox('payment-encryption-key');
    const enc = box.encrypt('rzp_secret_abcdef');
    expect(enc.startsWith('v1:')).toBe(true);
    expect(enc).not.toContain('rzp_secret_abcdef');
    expect(box.decrypt(enc)).toBe('rzp_secret_abcdef');
  });
});
