import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHmac } from 'crypto';
import { TwilioWhatsAppAdapter } from '../adapters/twilio-whatsapp-adapter';

const CONFIG = { accountSid: 'AC123', authToken: 'secrettoken', fromNumber: '+14155238886' };

describe('TwilioWhatsAppAdapter', () => {
  let adapter: TwilioWhatsAppAdapter;
  beforeEach(() => { adapter = new TwilioWhatsAppAdapter(CONFIG); });
  afterEach(() => { vi.restoreAllMocks(); });

  describe('parseInboundEvent', () => {
    it('parses a text WhatsApp message', () => {
      const msgs = adapter.parseInboundEvent({
        MessageSid: 'SM123',
        From: 'whatsapp:+919876543210',
        To: 'whatsapp:+14155238886',
        Body: 'I need a sunscreen for oily skin',
        ProfileName: 'Priya',
        NumMedia: '0',
      });
      expect(msgs.length).toBe(1);
      expect(msgs[0]?.providerMessageId).toBe('SM123');
      expect(msgs[0]?.from).toBe('+919876543210');
      expect(msgs[0]?.text).toBe('I need a sunscreen for oily skin');
      expect(msgs[0]?.type).toBe('text');
      expect((msgs[0]?.metadata as Record<string, unknown>)?.senderName).toBe('Priya');
    });

    it('ignores delivery status callbacks', () => {
      const msgs = adapter.parseInboundEvent({ MessageSid: 'SM9', From: 'whatsapp:+91', MessageStatus: 'delivered' });
      expect(msgs.length).toBe(0);
    });

    it('returns empty for malformed body', () => {
      expect(adapter.parseInboundEvent({}).length).toBe(0);
      expect(adapter.parseInboundEvent({ From: 'whatsapp:+91' }).length).toBe(0);
    });
  });

  describe('verifySignature', () => {
    const url = 'https://business-os-gateway.vercel.app/webhooks/twilio';
    const params = { From: 'whatsapp:+919876543210', Body: 'Hi', MessageSid: 'SM123' };

    function validSignature(): string {
      const data = Object.keys(params).sort().reduce((acc, k) => acc + k + (params as Record<string, string>)[k], url);
      return createHmac('sha1', CONFIG.authToken).update(Buffer.from(data, 'utf-8')).digest('base64');
    }

    it('accepts a correct signature', () => {
      expect(adapter.verifySignature(url, params, validSignature())).toBe(true);
    });
    it('rejects a tampered signature', () => {
      expect(adapter.verifySignature(url, params, validSignature() + 'x')).toBe(false);
    });
    it('rejects when the body was altered', () => {
      expect(adapter.verifySignature(url, { ...params, Body: 'Hacked' }, validSignature())).toBe(false);
    });
    it('rejects a missing signature', () => {
      expect(adapter.verifySignature(url, params, undefined)).toBe(false);
    });
  });

  describe('sendMessage', () => {
    it('POSTs to the Twilio Messages API with Basic auth and whatsapp: prefixes', async () => {
      const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({ sid: 'SMout1' }), { status: 201 }));
      vi.stubGlobal('fetch', fetchMock);

      const result = await adapter.sendMessage('org-1', { to: '+919876543210', type: 'text', text: 'Hello!', idempotencyKey: 'k1' });

      expect(result.success).toBe(true);
      expect(result.providerMessageId).toBe('SMout1');
      const call = fetchMock.mock.calls[0]!;
      const calledUrl = call[0];
      const init = call[1]!;
      expect(calledUrl).toBe('https://api.twilio.com/2010-04-01/Accounts/AC123/Messages.json');
      expect(init.headers).toMatchObject({ Authorization: `Basic ${Buffer.from('AC123:secrettoken').toString('base64')}` });
      const body = String(init.body);
      expect(body).toContain('From=whatsapp%3A%2B14155238886');
      expect(body).toContain('To=whatsapp%3A%2B919876543210');
      expect(body).toContain('Body=Hello%21');
    });

    it('returns an error on Twilio failure', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ message: 'Invalid number', code: 21211 }), { status: 400 })));
      const result = await adapter.sendMessage('org-1', { to: '+91', type: 'text', text: 'x', idempotencyKey: 'k2' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid number');
    });
  });
});
