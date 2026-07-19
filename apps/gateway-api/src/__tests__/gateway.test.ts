import { describe, it, expect, beforeEach } from 'vitest';
import { createApp } from '../app';
import { MockWhatsAppAdapter } from '../adapters/mock-whatsapp-adapter';
import { IdempotencyService } from '../services/idempotency-service';
import { MessageService } from '../services/message-service';
import http from 'http';

// ─── Helper to make HTTP requests to the Express app ─────────────────

function createTestServer(app: ReturnType<typeof createApp>) {
  const server = http.createServer(app);
  return server;
}

async function request(
  server: http.Server,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const addr = server.address();
    if (!addr || typeof addr === 'string') {
      reject(new Error('Server not listening'));
      return;
    }

    const data = body ? JSON.stringify(body) : undefined;
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: addr.port,
        path,
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
        },
      },
      (res) => {
        let responseBody = '';
        res.on('data', (chunk: Buffer) => {
          responseBody += chunk.toString();
        });
        res.on('end', () => {
          resolve({ status: res.statusCode ?? 500, body: responseBody });
        });
      },
    );
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

// ─── Test suites ─────────────────────────────────────────────────────

describe('Gateway API', () => {
  let adapter: MockWhatsAppAdapter;
  let idempotencyService: IdempotencyService;
  let messageService: MessageService;
  let server: http.Server;
  let inboundCallbacks: Array<{ orgId: string; message: { providerMessageId: string; from: string; text?: string } }>;

  beforeEach(async () => {
    adapter = new MockWhatsAppAdapter('test-token');
    idempotencyService = new IdempotencyService();
    messageService = new MessageService();
    inboundCallbacks = [];

    const app = createApp({
      adapter,
      idempotencyService,
      messageService,
      defaultOrgId: '11111111-1111-1111-1111-111111111111',
      onInboundMessage: async (orgId, message) => {
        inboundCallbacks.push({ orgId, message });
      },
    });

    server = createTestServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  // ─── Webhook verification ───────────────────────────────────────

  describe('GET /webhook', () => {
    it('returns challenge on valid verify token', async () => {
      const res = await request(
        server,
        'GET',
        '/webhook?hub.mode=subscribe&hub.verify_token=test-token&hub.challenge=test-challenge-123',
      );
      expect(res.status).toBe(200);
      expect(res.body).toBe('test-challenge-123');
    });

    it('returns 403 on invalid verify token', async () => {
      const res = await request(
        server,
        'GET',
        '/webhook?hub.mode=subscribe&hub.verify_token=wrong-token&hub.challenge=test',
      );
      expect(res.status).toBe(403);
    });

    it('returns 403 on missing parameters', async () => {
      const res = await request(server, 'GET', '/webhook');
      expect(res.status).toBe(403);
    });
  });

  // ─── Inbound webhook ───────────────────────────────────────────

  describe('POST /webhook', () => {
    const validWebhookBody = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'entry-1',
          changes: [
            {
              value: {
                messaging_product: 'whatsapp',
                messages: [
                  {
                    id: 'wamid.test123',
                    from: '+919876543210',
                    timestamp: String(Math.floor(Date.now() / 1000)),
                    type: 'text',
                    text: { body: 'I need a sunscreen for oily skin.' },
                  },
                ],
              },
              field: 'messages',
            },
          ],
        },
      ],
    };

    it('returns 200 immediately', async () => {
      const res = await request(server, 'POST', '/webhook', validWebhookBody);
      expect(res.status).toBe(200);
      expect(res.body).toBe('EVENT_RECEIVED');
    });

    it('persists inbound message', async () => {
      await request(server, 'POST', '/webhook', validWebhookBody);
      // Allow async processing
      await new Promise((r) => setTimeout(r, 50));
      const messages = messageService.getMessages();
      expect(messages.length).toBe(1);
      expect(messages[0]?.content).toBe('I need a sunscreen for oily skin.');
      expect(messages[0]?.direction).toBe('inbound');
    });

    it('invokes agent callback', async () => {
      await request(server, 'POST', '/webhook', validWebhookBody);
      await new Promise((r) => setTimeout(r, 50));
      expect(inboundCallbacks.length).toBe(1);
      expect(inboundCallbacks[0]?.message.text).toBe('I need a sunscreen for oily skin.');
    });

    it('deduplicates webhook events by provider_message_id', async () => {
      await request(server, 'POST', '/webhook', validWebhookBody);
      await request(server, 'POST', '/webhook', validWebhookBody);
      await new Promise((r) => setTimeout(r, 50));
      // Should only process once
      const messages = messageService.getMessages();
      expect(messages.length).toBe(1);
      expect(inboundCallbacks.length).toBe(1);
    });
  });

  // ─── Internal outbound messages ────────────────────────────────

  describe('POST /internal/messages', () => {
    it('sends outbound message successfully', async () => {
      const res = await request(server, 'POST', '/internal/messages', {
        organizationId: '11111111-1111-1111-1111-111111111111',
        to: '+919876543210',
        type: 'text',
        text: 'Hello from GlowRoot!',
        idempotencyKey: 'send-001',
      });
      expect(res.status).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.success).toBe(true);
      expect(body.providerMessageId).toBeDefined();
    });

    it('rejects duplicate outbound sends', async () => {
      await request(server, 'POST', '/internal/messages', {
        organizationId: '11111111-1111-1111-1111-111111111111',
        to: '+919876543210',
        text: 'Hello!',
        idempotencyKey: 'send-dup',
      });
      const res = await request(server, 'POST', '/internal/messages', {
        organizationId: '11111111-1111-1111-1111-111111111111',
        to: '+919876543210',
        text: 'Hello again!',
        idempotencyKey: 'send-dup',
      });
      expect(res.status).toBe(409);
    });

    it('rejects invalid payload', async () => {
      const res = await request(server, 'POST', '/internal/messages', {
        organizationId: 'not-a-uuid',
      });
      expect(res.status).toBe(400);
    });
  });

  // ─── Health check ──────────────────────────────────────────────

  describe('GET /health', () => {
    it('returns ok', async () => {
      const res = await request(server, 'GET', '/health');
      expect(res.status).toBe(200);
    });
  });
});

describe('IdempotencyService', () => {
  it('acquires first time, rejects second', () => {
    const svc = new IdempotencyService();
    expect(svc.tryAcquire('id-1')).toBe(true);
    expect(svc.tryAcquire('id-1')).toBe(false);
  });

  it('tracks different IDs independently', () => {
    const svc = new IdempotencyService();
    expect(svc.tryAcquire('id-1')).toBe(true);
    expect(svc.tryAcquire('id-2')).toBe(true);
    expect(svc.size).toBe(2);
  });
});

describe('MockWhatsAppAdapter', () => {
  it('verifies webhook with correct token', () => {
    const adapter = new MockWhatsAppAdapter('my-token');
    expect(adapter.verifyWebhook('my-token', 'challenge-abc')).toBe('challenge-abc');
  });

  it('rejects webhook with wrong token', () => {
    const adapter = new MockWhatsAppAdapter('my-token');
    expect(adapter.verifyWebhook('wrong', 'challenge')).toBeNull();
  });

  it('stores sent messages', async () => {
    const adapter = new MockWhatsAppAdapter();
    await adapter.sendMessage('org-1', {
      to: '+91123',
      type: 'text',
      text: 'Hello',
      idempotencyKey: 'key-1',
    });
    expect(adapter.getSentMessages().length).toBe(1);
  });
});
