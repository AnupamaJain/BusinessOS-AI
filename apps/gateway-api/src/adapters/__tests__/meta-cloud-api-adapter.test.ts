import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MetaCloudApiAdapter } from '../meta-cloud-api-adapter';

describe('MetaCloudApiAdapter', () => {
  const orgId = '11111111-1111-1111-1111-111111111111';

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('verifies valid webhook token challenge', () => {
    const adapter = new MetaCloudApiAdapter({
      accessToken: 'token',
      phoneNumberId: 'id',
      verifyToken: 'my-verify-token',
    });
    expect(adapter.verifyWebhook('my-verify-token', '12345')).toBe('12345');
    expect(adapter.verifyWebhook('wrong-token', '12345')).toBeNull();
  });

  it('rejects sendMessage when credentials are missing', async () => {
    const adapter = new MetaCloudApiAdapter({
      accessToken: '',
      phoneNumberId: '',
      verifyToken: 'my-token',
    });

    const result = await adapter.sendMessage(orgId, {
      to: '919876543210',
      type: 'text',
      text: 'hello',
      idempotencyKey: 'id-1',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Meta credentials missing');
  });

  it('sends text message via Meta Graph API successfully', async () => {
    const adapter = new MetaCloudApiAdapter({
      accessToken: 'ACCESS_TOKEN',
      phoneNumberId: 'PHONE_ID',
      verifyToken: 'VERIFY_TOKEN',
    });

    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        messaging_product: 'whatsapp',
        contacts: [{ input: '919876543210', wa_id: '919876543210' }],
        messages: [{ id: 'wamid.HBgLOTE5ODc2NTQzMjEwFQIAERg2MUFCMzRERDU3QTMwOUQyODkAA' }],
      }),
    } as Response);

    const result = await adapter.sendMessage(orgId, {
      to: '919876543210',
      type: 'text',
      text: 'Hello from GlowRoot',
      idempotencyKey: 'id-2',
    });

    expect(result.success).toBe(true);
    expect(result.providerMessageId).toBe('wamid.HBgLOTE5ODc2NTQzMjEwFQIAERg2MUFCMzRERDU3QTMwOUQyODkAA');

    expect(mockFetch).toHaveBeenCalledWith(
      'https://graph.facebook.com/v21.0/PHONE_ID/messages',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ACCESS_TOKEN',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: '919876543210',
          type: 'text',
          text: { body: 'Hello from GlowRoot' },
        }),
      })
    );
  });

  it('sends template message with params successfully', async () => {
    const adapter = new MetaCloudApiAdapter({
      accessToken: 'ACCESS_TOKEN',
      phoneNumberId: 'PHONE_ID',
      verifyToken: 'VERIFY_TOKEN',
    });

    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        messages: [{ id: 'wamid.template_message_id' }],
      }),
    } as Response);

    const result = await adapter.sendMessage(orgId, {
      to: '919876543210',
      type: 'template',
      templateKey: 'qualified_lead_24h_followup',
      templateParams: {
        '1': 'Priya',
        '2': 'AquaShield SPF 50',
      },
      idempotencyKey: 'id-3',
    });

    expect(result.success).toBe(true);
    expect(result.providerMessageId).toBe('wamid.template_message_id');

    expect(mockFetch).toHaveBeenCalledWith(
      'https://graph.facebook.com/v21.0/PHONE_ID/messages',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: '919876543210',
          type: 'template',
          template: {
            name: 'qualified_lead_24h_followup',
            language: { code: 'en' },
            components: [
              {
                type: 'body',
                parameters: [
                  { type: 'text', text: 'Priya' },
                  { type: 'text', text: 'AquaShield SPF 50' },
                ],
              },
            ],
          },
        }),
      })
    );
  });
});
