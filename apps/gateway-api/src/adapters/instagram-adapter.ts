import { z } from 'zod';
import type { WhatsAppAdapter, InboundMessage, OutboundMessage, SendResult } from './types';
import { logger } from '@business-os-ai/shared-types';

/**
 * Meta Messenger / Instagram Direct webhook payload schema (Graph API).
 *
 * Messenger and Instagram Direct share the same webhook envelope as the
 * WhatsApp Cloud API infra, but deliver messages under `entry[].messaging[]`
 * rather than `entry[].changes[]`. A `messaging` entry can be an inbound text,
 * a postback (tapped button/quick-reply), an echo of our own outbound message,
 * or a read / delivery receipt.
 *
 * Loose schema: only the fields we consume are described; unknown keys pass.
 */
const MessagingEntrySchema = z.object({
  sender: z.object({ id: z.string() }).optional(),
  recipient: z.object({ id: z.string() }).optional(),
  timestamp: z.number().optional(),
  message: z.object({
    mid: z.string().optional(),
    text: z.string().optional(),
    is_echo: z.boolean().optional(),
    attachments: z.array(z.unknown()).optional(),
  }).optional(),
  postback: z.object({
    mid: z.string().optional(),
    payload: z.string().optional(),
    title: z.string().optional(),
  }).optional(),
  read: z.object({}).passthrough().optional(),
  delivery: z.object({}).passthrough().optional(),
}).passthrough();

const IgWebhookBodySchema = z.object({
  object: z.string(),
  entry: z.array(z.object({
    id: z.string().optional(),
    time: z.number().optional(),
    messaging: z.array(MessagingEntrySchema).optional(),
  })),
});

/**
 * Meta Messenger + Instagram Direct adapter.
 *
 * Talks to the Graph API (`graph.facebook.com`) using a Page access token.
 * Inbound events arrive through the same webhook infrastructure as WhatsApp
 * but with the Messenger/IG payload shape; outbound messages are sent to a
 * PSID (Messenger) or IGSID (Instagram) via the Page's `/messages` edge.
 *
 * Required config:
 * - pageAccessToken (Page-scoped Graph API token)
 * - pageId          (Facebook Page id backing the Messenger / IG account)
 * - verifyToken     (webhook GET handshake token)
 * - channel         ('instagram' | 'messenger')
 */
export class InstagramMessengerAdapter implements WhatsAppAdapter {
  private readonly pageAccessToken: string;
  private readonly pageId: string;
  private readonly verifyToken: string;
  private readonly channel: 'instagram' | 'messenger';

  constructor(config: {
    pageAccessToken: string;
    pageId: string;
    verifyToken: string;
    channel: 'instagram' | 'messenger';
  }) {
    this.pageAccessToken = config.pageAccessToken;
    this.pageId = config.pageId;
    this.verifyToken = config.verifyToken;
    this.channel = config.channel;
  }

  verifyWebhook(token: string, challenge: string): string | null {
    if (token === this.verifyToken) {
      return challenge;
    }
    return null;
  }

  parseInboundEvent(body: unknown): InboundMessage[] {
    const parsed = IgWebhookBodySchema.safeParse(body);
    if (!parsed.success) {
      logger.warn('InstagramMessengerAdapter: unrecognised webhook body', { issues: parsed.error.issues.slice(0, 3) });
      return [];
    }

    const messages: InboundMessage[] = [];
    for (const entry of parsed.data.entry) {
      for (const m of entry.messaging ?? []) {
        // Skip read / delivery receipts and echoes of our own outbound sends.
        if (m.read || m.delivery) continue;
        if (m.message?.is_echo === true) continue;

        const senderId = m.sender?.id;
        if (!senderId) continue;

        let type: InboundMessage['type'];
        let text: string | undefined;
        let providerMessageId: string | undefined;

        if (m.message && typeof m.message.text === 'string' && m.message.text.length > 0) {
          type = 'text';
          text = m.message.text;
          providerMessageId = m.message.mid;
        } else if (m.postback && (m.postback.payload || m.postback.title)) {
          type = 'interactive';
          text = m.postback.title ?? m.postback.payload;
          providerMessageId = m.postback.mid;
        } else {
          // No usable text (attachment-only, empty, or unsupported) — skip.
          continue;
        }

        messages.push({
          providerMessageId: providerMessageId ?? `${senderId}:${m.timestamp ?? ''}`,
          from: senderId,
          timestamp: m.timestamp ? new Date(m.timestamp) : new Date(),
          type,
          text,
          metadata: {
            channel: this.channel,
            pageId: this.pageId,
            senderId,
            rawType: 'message',
          },
        });
      }
    }
    return messages;
  }

  async sendMessage(organizationId: string, message: OutboundMessage): Promise<SendResult> {
    if (!this.pageAccessToken || !this.pageId) {
      logger.warn('InstagramMessengerAdapter: credentials missing, failing request', {
        organizationId,
        recipient: message.to,
      });
      return {
        success: false,
        error: 'Instagram/Messenger credentials missing. Please configure the Page access token and Page id.',
      };
    }

    const url = `https://graph.facebook.com/v21.0/${this.pageId}/messages?access_token=${this.pageAccessToken}`;

    // Messenger / IG Direct basic text send has no native list UI, so lists and
    // CTAs are flattened into the message body. Reply buttons map to native
    // quick replies (max 3).
    const bodyText = InstagramMessengerAdapter.renderBody(message);
    const messagePayload: Record<string, unknown> = { text: bodyText || ' ' };

    if (message.buttons && message.buttons.length > 0) {
      messagePayload.quick_replies = message.buttons.slice(0, 3).map((b) => ({
        content_type: 'text',
        title: b.title.slice(0, 20),
        payload: b.id.slice(0, 256),
      }));
    }

    const payload = {
      recipient: { id: message.to },
      messaging_type: 'RESPONSE',
      message: messagePayload,
    };

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errText = await response.text();
        logger.error('Instagram/Messenger Graph API error response', {
          status: response.status,
          response: errText,
          organizationId,
        });
        return {
          success: false,
          error: `Graph API returned HTTP ${response.status}: ${errText}`,
        };
      }

      const resData = (await response.json()) as { message_id?: string; recipient_id?: string };
      const providerMessageId = resData.message_id;

      logger.info('Instagram/Messenger message sent successfully', {
        organizationId,
        providerMessageId,
        channel: this.channel,
      });

      return { success: true, providerMessageId };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error('Instagram/Messenger communication error', { error: errorMsg, organizationId });
      return {
        success: false,
        error: `Failed to communicate with Graph API: ${errorMsg}`,
      };
    }
  }

  /**
   * Flattens a rich outbound message (text + list + cta) into a single text
   * string suitable for the basic Messenger/IG text send. Reply buttons are
   * handled separately as native quick replies and are not rendered here.
   * Exposed as a static helper for unit testing.
   */
  static renderBody(message: OutboundMessage): string {
    const parts: string[] = [];
    if (message.text) parts.push(message.text.trim());

    if (message.list) {
      const lines: string[] = [];
      if (message.list.header) lines.push(message.list.header);
      message.list.items.forEach((it, i) => {
        lines.push(`${i + 1}. ${it.title}${it.description ? ` — ${it.description}` : ''}`);
      });
      lines.push('\nReply with the number to choose.');
      parts.push(lines.join('\n'));
    }

    if (message.cta) {
      parts.push(`${message.cta.label}: ${message.cta.url}`);
    }

    return parts.filter(Boolean).join('\n\n');
  }
}
