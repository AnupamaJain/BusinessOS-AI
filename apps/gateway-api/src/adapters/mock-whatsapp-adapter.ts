import { z } from 'zod';
import type { WhatsAppAdapter, InboundMessage, OutboundMessage, SendResult } from './types';
import { logger } from '@whatsapp-smb/shared-types';
import { randomUUID } from 'crypto';

/**
 * Meta Cloud API webhook payload schema (simplified).
 */
const MetaWebhookEntrySchema = z.object({
  id: z.string(),
  changes: z.array(z.object({
    value: z.object({
      messaging_product: z.string().optional(),
      metadata: z.object({
        display_phone_number: z.string().optional(),
        phone_number_id: z.string().optional(),
      }).optional(),
      messages: z.array(z.object({
        id: z.string(),
        from: z.string(),
        timestamp: z.string(),
        type: z.string(),
        text: z.object({ body: z.string() }).optional(),
      })).optional(),
    }),
    field: z.string(),
  })),
});

const MetaWebhookBodySchema = z.object({
  object: z.string(),
  entry: z.array(MetaWebhookEntrySchema),
});

/**
 * Mock WhatsApp adapter for development and testing.
 * Saves outbound messages in memory and prints to console.
 */
export class MockWhatsAppAdapter implements WhatsAppAdapter {
  private readonly verifyToken: string;
  public readonly sentMessages: Array<{ organizationId: string; message: OutboundMessage; providerMessageId: string }> = [];

  constructor(verifyToken = 'test-verify-token') {
    this.verifyToken = verifyToken;
  }

  verifyWebhook(token: string, challenge: string): string | null {
    if (token === this.verifyToken) {
      return challenge;
    }
    return null;
  }

  parseInboundEvent(body: unknown): InboundMessage[] {
    const parsed = MetaWebhookBodySchema.safeParse(body);
    if (!parsed.success) {
      logger.warn('MockAdapter: invalid webhook body', { });
      return [];
    }

    const messages: InboundMessage[] = [];
    for (const entry of parsed.data.entry) {
      for (const change of entry.changes) {
        if (change.field !== 'messages') continue;
        for (const msg of change.value.messages ?? []) {
          messages.push({
            providerMessageId: msg.id,
            from: msg.from,
            timestamp: new Date(parseInt(msg.timestamp, 10) * 1000),
            type: msg.type === 'text' ? 'text' : 'system',
            text: msg.text?.body,
          });
        }
      }
    }
    return messages;
  }

  async sendMessage(organizationId: string, message: OutboundMessage): Promise<SendResult> {
    const providerMessageId = `mock_${randomUUID()}`;
    this.sentMessages.push({ organizationId, message, providerMessageId });
    logger.info('MockAdapter: message sent', {
      organizationId,
      providerMessageId,
    });
    return { success: true, providerMessageId };
  }

  /** Helper for tests — get all sent messages. */
  getSentMessages() {
    return [...this.sentMessages];
  }

  /** Helper for tests — clear sent messages. */
  clearSentMessages() {
    this.sentMessages.length = 0;
  }
}
