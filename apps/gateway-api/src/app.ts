import express from 'express';
import type { WhatsAppAdapter, OutboundMessage } from './adapters/types';
import { IdempotencyService } from './services/idempotency-service';
import { MessageService } from './services/message-service';
import { logger } from '@whatsapp-smb/shared-types';
import { z } from 'zod';

/**
 * Creates the Express app with webhook and internal message routes.
 */
export function createApp(deps: {
  adapter: WhatsAppAdapter;
  idempotencyService: IdempotencyService;
  messageService: MessageService;
  defaultOrgId: string;
  onInboundMessage?: (orgId: string, message: { providerMessageId: string; from: string; text?: string }) => void | Promise<void>;
}): express.Express {
  const app = express();
  app.use(express.json());

  const { adapter, idempotencyService, messageService, defaultOrgId } = deps;

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
   * Quickly returns 200, then processes asynchronously.
   */
  app.post('/webhook', (req, res) => {
    // Return 200 immediately per Meta requirements
    res.status(200).send('EVENT_RECEIVED');

    // Process asynchronously
    void (async () => {
      try {
        const messages = adapter.parseInboundEvent(req.body);
        for (const msg of messages) {
          // Idempotency check
          if (!idempotencyService.tryAcquire(msg.providerMessageId)) {
            logger.info('Duplicate webhook event skipped', {
              providerMessageId: msg.providerMessageId,
            });
            continue;
          }

          // Persist inbound message
          await messageService.persistInbound(defaultOrgId, msg);

          // Invoke agent service (callback)
          if (deps.onInboundMessage) {
            await deps.onInboundMessage(defaultOrgId, {
              providerMessageId: msg.providerMessageId,
              from: msg.from,
              text: msg.text,
            });
          }
        }
      } catch (err) {
        logger.error('Webhook processing error', {}, err instanceof Error ? err : new Error(String(err)));
      }
    })();
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
    if (!idempotencyService.tryAcquire(`outbound:${messageData.idempotencyKey}`)) {
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
        messageData.text ?? '',
        result.providerMessageId,
      );
    }

    res.status(result.success ? 200 : 500).json(result);
  });

  /** Health check */
  app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  return app;
}
