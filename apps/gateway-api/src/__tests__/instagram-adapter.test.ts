import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { InstagramMessengerAdapter } from '../adapters/instagram-adapter';

const CONFIG = {
  pageAccessToken: 'PAGE_TOKEN_123',
  pageId: '17841400000000000',
  verifyToken: 'verify-secret',
  channel: 'instagram' as const,
};

describe('InstagramMessengerAdapter', () => {
  let adapter: InstagramMessengerAdapter;
  beforeEach(() => { adapter = new InstagramMessengerAdapter(CONFIG); });
  afterEach(() => { vi.restoreAllMocks(); });

  describe('verifyWebhook', () => {
    it('returns the challenge when the token matches', () => {
      expect(adapter.verifyWebhook('verify-secret', 'chal-42')).toBe('chal-42');
    });
    it('returns null when the token does not match', () => {
      expect(adapter.verifyWebhook('wrong', 'chal-42')).toBeNull();
    });
  });

  describe('parseInboundEvent', () => {
    it('parses an Instagram Direct text message', () => {
      const msgs = adapter.parseInboundEvent({
        object: 'instagram',
        entry: [{
          id: '17841400000000000',
          time: 1721400000000,
          messaging: [{
            sender: { id: 'IGSID_555' },
            recipient: { id: '17841400000000000' },
            timestamp: 1721400000000,
            message: { mid: 'mid.abc123', text: 'Do you have this in blue?' },
          }],
        }],
      });
      expect(msgs.length).toBe(1);
      expect(msgs[0]?.from).toBe('IGSID_555');
      expect(msgs[0]?.providerMessageId).toBe('mid.abc123');
      expect(msgs[0]?.text).toBe('Do you have this in blue?');
      expect(msgs[0]?.type).toBe('text');
      expect((msgs[0]?.metadata as Record<string, unknown>)?.channel).toBe('instagram');
      expect((msgs[0]?.metadata as Record<string, unknown>)?.senderId).toBe('IGSID_555');
    });

    it('parses a postback into an interactive message', () => {
      const msgs = adapter.parseInboundEvent({
        object: 'page',
        entry: [{
          id: 'PAGE_1',
          messaging: [{
            sender: { id: 'PSID_1' },
            recipient: { id: 'PAGE_1' },
            timestamp: 1721400001000,
            postback: { mid: 'mid.pb1', payload: 'BOOK_NOW', title: 'Book now' },
          }],
        }],
      });
      expect(msgs.length).toBe(1);
      expect(msgs[0]?.type).toBe('interactive');
      expect(msgs[0]?.text).toBe('Book now');
      expect(msgs[0]?.from).toBe('PSID_1');
    });

    it('falls back to sender:timestamp when mid is missing', () => {
      const msgs = adapter.parseInboundEvent({
        object: 'instagram',
        entry: [{
          messaging: [{
            sender: { id: 'IGSID_9' },
            recipient: { id: 'PAGE' },
            timestamp: 1721400002000,
            message: { text: 'hi' },
          }],
        }],
      });
      expect(msgs.length).toBe(1);
      expect(msgs[0]?.providerMessageId).toBe('IGSID_9:1721400002000');
    });

    it('ignores echoes of our own outbound messages', () => {
      const msgs = adapter.parseInboundEvent({
        object: 'instagram',
        entry: [{
          messaging: [{
            sender: { id: '17841400000000000' },
            recipient: { id: 'IGSID_555' },
            timestamp: 1721400003000,
            message: { mid: 'mid.echo', text: 'Sure, in stock!', is_echo: true },
          }],
        }],
      });
      expect(msgs.length).toBe(0);
    });

    it('ignores read and delivery receipts', () => {
      const read = adapter.parseInboundEvent({
        object: 'instagram',
        entry: [{ messaging: [{ sender: { id: 'IGSID_1' }, recipient: { id: 'PAGE' }, read: { watermark: 1721400004000 } }] }],
      });
      const delivery = adapter.parseInboundEvent({
        object: 'instagram',
        entry: [{ messaging: [{ sender: { id: 'IGSID_1' }, recipient: { id: 'PAGE' }, delivery: { watermark: 1721400004000 } }] }],
      });
      expect(read.length).toBe(0);
      expect(delivery.length).toBe(0);
    });

    it('returns [] for a malformed body', () => {
      expect(adapter.parseInboundEvent({}).length).toBe(0);
      expect(adapter.parseInboundEvent({ object: 'instagram' }).length).toBe(0);
      expect(adapter.parseInboundEvent(null).length).toBe(0);
      expect(adapter.parseInboundEvent('nope').length).toBe(0);
    });
  });

  describe('sendMessage', () => {
    it('POSTs to the Graph messages URL with recipient.id and message.text', async () => {
      const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
        new Response(JSON.stringify({ recipient_id: 'IGSID_555', message_id: 'mid.out99' }), { status: 200 }));
      vi.stubGlobal('fetch', fetchMock);

      const result = await adapter.sendMessage('org-1', {
        to: 'IGSID_555',
        type: 'text',
        text: 'Yes, we have it in blue!',
        idempotencyKey: 'k1',
      });

      expect(result.success).toBe(true);
      expect(result.providerMessageId).toBe('mid.out99');

      const call = fetchMock.mock.calls[0]!;
      const calledUrl = String(call[0]);
      expect(calledUrl).toContain('https://graph.facebook.com/v21.0/17841400000000000/messages');
      expect(calledUrl).toContain('access_token=PAGE_TOKEN_123');

      const init = call[1]!;
      const payload = JSON.parse(String(init.body));
      expect(payload.recipient.id).toBe('IGSID_555');
      expect(payload.messaging_type).toBe('RESPONSE');
      expect(payload.message.text).toBe('Yes, we have it in blue!');
    });

    it('maps buttons to native quick_replies', async () => {
      const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({ message_id: 'mid.qr' }), { status: 200 }));
      vi.stubGlobal('fetch', fetchMock);

      await adapter.sendMessage('org-1', {
        to: 'PSID_1',
        type: 'interactive',
        text: 'Pick one:',
        buttons: [{ id: 'a', title: 'Option A' }, { id: 'b', title: 'Option B' }],
        idempotencyKey: 'k2',
      });

      const payload = JSON.parse(String(fetchMock.mock.calls[0]![1]!.body));
      expect(payload.message.quick_replies).toHaveLength(2);
      expect(payload.message.quick_replies[0]).toMatchObject({ content_type: 'text', title: 'Option A', payload: 'a' });
    });

    it('returns an error on a non-2xx response', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => new Response('Invalid OAuth access token', { status: 400 })));
      const result = await adapter.sendMessage('org-1', { to: 'IGSID_1', type: 'text', text: 'x', idempotencyKey: 'k3' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('HTTP 400');
    });

    it('returns an error when fetch throws', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down'); }));
      const result = await adapter.sendMessage('org-1', { to: 'IGSID_1', type: 'text', text: 'x', idempotencyKey: 'k4' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('network down');
    });
  });

  describe('renderBody', () => {
    it('flattens a list into a numbered menu', () => {
      const body = InstagramMessengerAdapter.renderBody({
        to: 'IGSID_1',
        type: 'interactive',
        text: 'Choose a service:',
        list: {
          header: 'Our services',
          button: 'View',
          items: [
            { id: 'haircut', title: 'Haircut', description: '30 min' },
            { id: 'color', title: 'Coloring' },
          ],
        },
        idempotencyKey: 'k5',
      });
      expect(body).toContain('Choose a service:');
      expect(body).toContain('Our services');
      expect(body).toContain('1. Haircut — 30 min');
      expect(body).toContain('2. Coloring');
      expect(body).toContain('Reply with the number to choose.');
    });

    it('appends a cta url to the text', () => {
      const body = InstagramMessengerAdapter.renderBody({
        to: 'IGSID_1',
        type: 'interactive',
        text: 'Book your slot',
        cta: { label: 'Book here', url: 'https://example.com/book' },
        idempotencyKey: 'k6',
      });
      expect(body).toContain('Book your slot');
      expect(body).toContain('Book here: https://example.com/book');
    });
  });
});
