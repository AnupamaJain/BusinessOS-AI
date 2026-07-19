import { z } from 'zod';

/**
 * Normalized inbound message from any WhatsApp provider.
 */
export const InboundMessageSchema = z.object({
  providerMessageId: z.string(),
  from: z.string(),
  timestamp: z.coerce.date(),
  type: z.enum(['text', 'image', 'document', 'interactive', 'reaction', 'system']),
  text: z.string().optional(),
  mediaUrl: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});
export type InboundMessage = z.infer<typeof InboundMessageSchema>;

/**
 * Outbound message request.
 */
export const OutboundMessageSchema = z.object({
  to: z.string(),
  type: z.enum(['text', 'template', 'interactive']),
  text: z.string().optional(),
  templateKey: z.string().optional(),
  templateParams: z.record(z.string()).optional(),
  idempotencyKey: z.string(),
});
export type OutboundMessage = z.infer<typeof OutboundMessageSchema>;

/**
 * Response from sending a message.
 */
export interface SendResult {
  success: boolean;
  providerMessageId?: string;
  error?: string;
}

/**
 * WhatsApp adapter interface — abstracts provider-specific API calls.
 */
export interface WhatsAppAdapter {
  sendMessage(organizationId: string, message: OutboundMessage): Promise<SendResult>;
  verifyWebhook(token: string, challenge: string): string | null;
  parseInboundEvent(body: unknown): InboundMessage[];
}
