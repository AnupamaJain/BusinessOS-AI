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
 * Interactive reply button (WhatsApp allows up to 3). Titles ≤ 20 chars.
 */
export const ReplyButtonSchema = z.object({
  id: z.string().max(256),
  title: z.string().max(20),
});
export type ReplyButton = z.infer<typeof ReplyButtonSchema>;

/**
 * Interactive list (WhatsApp allows up to 10 rows). Row titles ≤ 24 chars,
 * descriptions ≤ 72 chars.
 */
export const InteractiveListSchema = z.object({
  header: z.string().max(60).optional(),
  button: z.string().max(20),
  items: z.array(z.object({
    id: z.string().max(200),
    title: z.string().max(24),
    description: z.string().max(72).optional(),
  })).min(1).max(10),
});
export type InteractiveList = z.infer<typeof InteractiveListSchema>;

/**
 * Call-to-action URL button (e.g. a payment or booking link).
 */
export const CtaSchema = z.object({
  label: z.string().max(20),
  url: z.string().url(),
});
export type Cta = z.infer<typeof CtaSchema>;

/**
 * Outbound message request. `text` is the message body; the optional
 * `buttons` / `list` / `cta` promote it to a rich interactive message on
 * providers that support it (falling back to formatted text elsewhere).
 */
export const OutboundMessageSchema = z.object({
  to: z.string(),
  type: z.enum(['text', 'template', 'interactive']),
  text: z.string().optional(),
  templateKey: z.string().optional(),
  templateParams: z.record(z.string()).optional(),
  buttons: z.array(ReplyButtonSchema).max(3).optional(),
  list: InteractiveListSchema.optional(),
  cta: CtaSchema.optional(),
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
