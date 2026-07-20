import express from 'express';
import { createHmac, timingSafeEqual } from 'crypto';
import type { WhatsAppAdapter, OutboundMessage, InboundMessage } from './adapters/types';
import type { MessagePersistence, IdempotencyStore } from './services/message-service';
import { logger } from '@business-os-ai/shared-types';
import { z } from 'zod';

export interface InboundCallbackMessage {
  providerMessageId: string;
  from: string;
  text?: string;
  type?: string;
  contactId?: string;
  conversationId?: string;
  metadata?: Record<string, unknown>;
}

export interface CreateAppDeps {
  adapter: WhatsAppAdapter;
  idempotencyService: IdempotencyStore;
  messageService: MessagePersistence;
  defaultOrgId: string;
  onInboundMessage?: (orgId: string, message: InboundCallbackMessage, replyAdapter?: WhatsAppAdapter) => void | Promise<void>;
  /** Multi-tenant: resolve the owning org + reply adapter for an inbound message. */
  resolveInbound?: (message: InboundMessage) => Promise<{ organizationId: string; replyAdapter: WhatsAppAdapter } | null>;
  /** Meta app secret — enables X-Hub-Signature-256 verification when set. */
  appSecret?: string;
  /** Allowed browser origins for /api/* routes (operator dashboard). */
  corsOrigins?: string[];
  /** Register additional production routes (operator API, internal endpoints). */
  registerRoutes?: (app: express.Express) => void;
  /** Middleware applied before all routes (e.g. Vercel OIDC token capture). */
  preMiddleware?: express.RequestHandler;
  /**
   * Keeps post-response webhook processing alive on serverless platforms
   * (Vercel freezes the function after the response unless waitUntil is used).
   */
  backgroundTask?: (work: Promise<unknown>) => void;
}

/**
 * Creates the Express app with webhook and internal message routes.
 */
export function createApp(deps: CreateAppDeps): express.Express {
  const app = express();

  if (deps.preMiddleware) {
    app.use(deps.preMiddleware);
  }

  // Capture the raw body for webhook signature verification
  app.use(express.json({
    verify: (req, _res, buf) => {
      (req as express.Request & { rawBody?: Buffer }).rawBody = buf;
    },
  }));

  const { adapter, idempotencyService, messageService, defaultOrgId } = deps;

  // ─── CORS for browser-facing /api routes ─────────────────────────
  const corsOrigins = deps.corsOrigins ?? [];
  app.use('/api', (req, res, next) => {
    const origin = req.headers.origin;
    if (origin && (corsOrigins.includes('*') || corsOrigins.includes(origin))) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    }
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  });

  /**
   * GET /webhook — Meta verification challenge.
   */
  app.get('/webhook', (req, res) => {
    const mode = req.query['hub.mode'] as string | undefined;
    const token = req.query['hub.verify_token'] as string | undefined;
    const challenge = req.query['hub.challenge'] as string | undefined;

    if (mode === 'subscribe' && token && challenge) {
      const result = adapter.verifyWebhook(token, challenge);
      if (result) {
        logger.info('Webhook verified');
        res.status(200).send(result);
        return;
      }
    }
    res.status(403).send('Forbidden');
  });

  /**
   * POST /webhook — Inbound WhatsApp events.
   * Verifies the Meta HMAC signature (when configured), returns 200 quickly,
   * then processes asynchronously.
   */
  app.post('/webhook', (req, res) => {
    if (deps.appSecret) {
      const signature = req.headers['x-hub-signature-256'];
      const rawBody = (req as express.Request & { rawBody?: Buffer }).rawBody;
      if (!verifyMetaSignature(deps.appSecret, rawBody, typeof signature === 'string' ? signature : undefined)) {
        logger.warn('Webhook rejected: invalid X-Hub-Signature-256');
        res.status(401).send('Invalid signature');
        return;
      }
    }

    // Return 200 immediately per Meta requirements
    res.status(200).send('EVENT_RECEIVED');

    // Process asynchronously (kept alive via waitUntil on serverless)
    const processing = (async () => {
      try {
        const messages = adapter.parseInboundEvent(req.body);
        for (const msg of messages) {
          // Idempotency check (durable in production)
          const acquired = await idempotencyService.tryAcquire(msg.providerMessageId);
          if (!acquired) {
            logger.info('Duplicate webhook event skipped', {
              providerMessageId: msg.providerMessageId,
            });
            continue;
          }

          // Multi-tenant: resolve which org owns this number (Embedded Signup);
          // fall back to the platform default org + primary adapter.
          const routed = deps.resolveInbound ? await deps.resolveInbound(msg) : null;
          const orgId = routed?.organizationId ?? defaultOrgId;
          const replyAdapter = routed?.replyAdapter ?? adapter;

          // Persist inbound message (resolves contact + conversation)
          const stored = await messageService.persistInbound(orgId, msg);

          // Invoke agent service (callback)
          if (deps.onInboundMessage) {
            await deps.onInboundMessage(orgId, {
              providerMessageId: msg.providerMessageId,
              from: msg.from,
              text: msg.text,
              type: msg.type,
              contactId: stored.contactId,
              conversationId: stored.conversationId,
              metadata: msg.metadata,
            }, replyAdapter);
          }
        }
      } catch (err) {
        logger.error('Webhook processing error', {}, err instanceof Error ? err : new Error(String(err)));
      }
    })();

    if (deps.backgroundTask) {
      deps.backgroundTask(processing);
    } else {
      void processing;
    }
  });

  /**
   * POST /internal/messages — Controlled outbound message enqueue.
   * Internal service-to-service endpoint.
   */
  const InternalMessageSchema = z.object({
    organizationId: z.string().uuid(),
    to: z.string().min(7),
    type: z.enum(['text', 'template', 'interactive']).default('text'),
    text: z.string().optional(),
    templateKey: z.string().optional(),
    templateParams: z.record(z.string()).optional(),
    idempotencyKey: z.string(),
  });

  app.post('/internal/messages', async (req, res) => {
    const parsed = InternalMessageSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid request', details: parsed.error.issues });
      return;
    }

    const { organizationId, ...messageData } = parsed.data;

    // Check idempotency
    const acquired = await idempotencyService.tryAcquire(`outbound:${messageData.idempotencyKey}`);
    if (!acquired) {
      res.status(409).json({ error: 'Duplicate send request', idempotencyKey: messageData.idempotencyKey });
      return;
    }

    const outbound: OutboundMessage = {
      to: messageData.to,
      type: messageData.type,
      text: messageData.text,
      templateKey: messageData.templateKey,
      templateParams: messageData.templateParams,
      idempotencyKey: messageData.idempotencyKey,
    };

    const result = await adapter.sendMessage(organizationId, outbound);

    if (result.success && result.providerMessageId) {
      await messageService.persistOutbound(
        organizationId,
        messageData.to,
        messageData.text ?? `[template:${messageData.templateKey}]`,
        result.providerMessageId,
      );
    }

    res.status(result.success ? 200 : 500).json(result);
  });

  /** Liveness — the process is up. Readiness (with DB) is /health/ready. */
  app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  // Production-only routes (operator API, internal RAG/scheduler endpoints).
  deps.registerRoutes?.(app);

  return app;
}

function verifyMetaSignature(appSecret: string, rawBody: Buffer | undefined, signatureHeader: string | undefined): boolean {
  if (!rawBody || !signatureHeader || !signatureHeader.startsWith('sha256=')) return false;
  const expected = createHmac('sha256', appSecret).update(rawBody).digest('hex');
  const provided = signatureHeader.slice('sha256='.length);
  if (provided.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(provided, 'hex'), Buffer.from(expected, 'hex'));
  } catch {
    return false;
  }
}
