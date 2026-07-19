import { describe, it, expect, vi, afterEach } from 'vitest';
import { TwilioWhatsAppAdapter } from '../adapters/twilio-whatsapp-adapter';
import { MetaCloudApiAdapter } from '../adapters/meta-cloud-api-adapter';
import type { OutboundMessage } from '../adapters/types';

const LIST_MSG: OutboundMessage = {
  to: '+919876543210', type: 'interactive', idempotencyKey: 'k1',
  text: 'Here are our top packages:',
  list: {
    header: 'Our holiday packages', button: 'View packages',
    items: [
      { id: 'TRV-BALI-001', title: 'Bali Honeymoon', description: '₹49,999 · 6 days' },
      { id: 'TRV-GOA-003', title: 'Goa Beach Rush', description: '₹14,999 · 4 days' },
    ],
  },
};

describe('Twilio interactive → text flattening', () => {
  it('renders a list as a numbered menu with the body', () => {
    const body = TwilioWhatsAppAdapter.renderBody(LIST_MSG);
    expect(body).toContain('Here are our top packages:');
    expect(body).toContain('1. *Bali Honeymoon* — ₹49,999 · 6 days');
    expect(body).toContain('2. *Goa Beach Rush*');
    expect(body).toContain('Reply with the name or number');
  });

  it('renders buttons and a cta link', () => {
    const body = TwilioWhatsAppAdapter.renderBody({
      to: '+91', type: 'interactive', idempotencyKey: 'k', text: 'How can I help?',
      buttons: [{ id: 'a', title: 'Browse offers' }, { id: 'b', title: 'Talk to a human' }],
      cta: { label: 'Pay now', url: 'https://pay.example.com/x' },
    });
    expect(body).toContain('▸ Browse offers');
    expect(body).toContain('▸ Talk to a human');
    expect(body).toContain('Pay now: https://pay.example.com/x');
  });
});

describe('Meta interactive payloads', () => {
  const adapter = new MetaCloudApiAdapter({ accessToken: 'tok', phoneNumberId: '123', verifyToken: 'v' });
  afterEach(() => vi.restoreAllMocks());

  async function capture(msg: OutboundMessage): Promise<any> {
    const fetchMock = vi.fn(async (_u: string, _init?: RequestInit) => new Response(JSON.stringify({ messages: [{ id: 'wamid.1' }] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await adapter.sendMessage('org', msg);
    return JSON.parse(String((fetchMock.mock.calls[0]![1] as RequestInit).body));
  }

  it('builds an interactive list payload', async () => {
    const p = await capture(LIST_MSG);
    expect(p.type).toBe('interactive');
    expect(p.interactive.type).toBe('list');
    expect(p.interactive.action.button).toBe('View packages');
    expect(p.interactive.action.sections[0].rows).toHaveLength(2);
    expect(p.interactive.action.sections[0].rows[0].id).toBe('TRV-BALI-001');
  });

  it('builds a reply-button payload', async () => {
    const p = await capture({ to: '+91', type: 'interactive', idempotencyKey: 'k', text: 'Hi', buttons: [{ id: 'x', title: 'Browse' }] });
    expect(p.interactive.type).toBe('button');
    expect(p.interactive.action.buttons[0].reply.title).toBe('Browse');
  });

  it('builds a cta_url payload for payment links', async () => {
    const p = await capture({ to: '+91', type: 'interactive', idempotencyKey: 'k', text: 'Pay', cta: { label: 'Pay securely', url: 'https://rzp.io/x' } });
    expect(p.interactive.type).toBe('cta_url');
    expect(p.interactive.action.parameters.url).toBe('https://rzp.io/x');
  });

  it('falls back to text when no interactive fields', async () => {
    const p = await capture({ to: '+91', type: 'text', idempotencyKey: 'k', text: 'plain' });
    expect(p.type).toBe('text');
    expect(p.text.body).toBe('plain');
  });
});
