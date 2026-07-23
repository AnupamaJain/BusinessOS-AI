import { z } from 'zod';
import type { WhatsAppAdapter, InboundMessage, OutboundMessage, SendResult } from './types';
import { logger } from '@business-os-ai/shared-types';

/**
 * Meta WhatsApp Cloud API webhook payload schema.
 * Covers text, interactive (button/list replies), button, media and status events.
 */
const MetaInboundMessageSchema = z.object({
  id: z.string(),
  from: z.string(),
  timestamp: z.string(),
  type: z.string(),
  text: z.object({ body: z.string() }).optional(),
  button: z.object({ text: z.string().optional(), payload: z.string().optional() }).optional(),
  interactive: z.object({
    type: z.string().optional(),
    button_reply: z.object({ id: z.string(), title: z.string() }).optional(),
    list_reply: z.object({ id: z.string(), title: z.string() }).optional(),
  }).optional(),
  image: z.object({ id: z.string().optional(), mime_type: z.string().optional(), caption: z.string().optional() }).optional(),
  document: z.object({ id: z.string().optional(), mime_type: z.string().optional(), caption: z.string().optional(), filename: z.string().optional() }).optional(),
  audio: z.object({ id: z.string().optional(), mime_type: z.string().optional(), voice: z.boolean().optional() }).optional(),
  reaction: z.object({ message_id: z.string().optional(), emoji: z.string().optional() }).optional(),
});

const MetaWebhookBodySchema = z.object({
  object: z.string(),
  entry: z.array(z.object({
    id: z.string(),
    changes: z.array(z.object({
      value: z.object({
        messaging_product: z.string().optional(),
        metadata: z.object({
          display_phone_number: z.string().optional(),
          phone_number_id: z.string().optional(),
        }).optional(),
        contacts: z.array(z.object({
          wa_id: z.string().optional(),
          profile: z.object({ name: z.string().optional() }).optional(),
        })).optional(),
        messages: z.array(MetaInboundMessageSchema).optional(),
        statuses: z.array(z.unknown()).optional(),
      }),
      field: z.string(),
    })),
  })),
});

/**
 * Meta WhatsApp Cloud API adapter.
 * Sends messages via graph.facebook.com and parses real webhook payloads.
 *
 * Required env vars:
 * - META_WHATSAPP_ACCESS_TOKEN
 * - META_WHATSAPP_PHONE_NUMBER_ID
 * - META_VERIFY_TOKEN
 */
export class MetaCloudApiAdapter implements WhatsAppAdapter {
  private readonly accessToken: string;
  private readonly phoneNumberId: string;
  private readonly verifyToken: string;

  constructor(config: {
    accessToken: string;
    phoneNumberId: string;
    verifyToken: string;
  }) {
    this.accessToken = config.accessToken;
    this.phoneNumberId = config.phoneNumberId;
    this.verifyToken = config.verifyToken;
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
      logger.warn('MetaCloudApiAdapter: unrecognised webhook body', { issues: parsed.error.issues.slice(0, 3) });
      return [];
    }

    const messages: InboundMessage[] = [];
    for (const entry of parsed.data.entry) {
      for (const change of entry.changes) {
        if (change.field !== 'messages') continue;
        const value = change.value;
        const senderName = value.contacts?.[0]?.profile?.name;
        for (const msg of value.messages ?? []) {
          // Normalise message text across supported types
          let text: string | undefined;
          let type: InboundMessage['type'] = 'system';
          if (msg.type === 'text' && msg.text) {
            type = 'text';
            text = msg.text.body;
          } else if (msg.type === 'interactive' && msg.interactive) {
            type = 'interactive';
            text = msg.interactive.button_reply?.title ?? msg.interactive.list_reply?.title;
          } else if (msg.type === 'button' && msg.button) {
            type = 'interactive';
            text = msg.button.text ?? msg.button.payload;
          } else if (msg.type === 'image') {
            type = 'image';
            text = msg.image?.caption;
          } else if (msg.type === 'document') {
            type = 'document';
            text = msg.document?.caption ?? msg.document?.filename;
          } else if (msg.type === 'audio' || msg.type === 'voice') {
            type = 'audio'; // WhatsApp voice notes — transcribed downstream
          } else if (msg.type === 'reaction') {
            type = 'reaction';
            text = msg.reaction?.emoji;
          }

          messages.push({
            providerMessageId: msg.id,
            from: msg.from,
            timestamp: new Date(parseInt(msg.timestamp, 10) * 1000),
            type,
            text,
            metadata: {
              phoneNumberId: value.metadata?.phone_number_id,
              displayPhoneNumber: value.metadata?.display_phone_number,
              senderName,
              rawType: msg.type,
              channel: 'meta',
              mediaId: msg.image?.id ?? msg.document?.id ?? msg.audio?.id,
              mediaMime: msg.image?.mime_type ?? msg.document?.mime_type ?? msg.audio?.mime_type,
            },
          });
        }
      }
    }
    return messages;
  }

  async sendMessage(organizationId: string, message: OutboundMessage): Promise<SendResult> {
    if (!this.accessToken || !this.phoneNumberId) {
      logger.warn('MetaCloudApiAdapter: credentials missing, failing request', {
        organizationId,
        recipient: message.to,
      });
      return {
        success: false,
        error: 'Meta credentials missing. Please configure META_WHATSAPP_ACCESS_TOKEN and META_WHATSAPP_PHONE_NUMBER_ID.',
      };
    }

    const url = `https://graph.facebook.com/v21.0/${this.phoneNumberId}/messages`;
    const base: Record<string, unknown> = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: message.to,
    };
    const body = message.text ?? ' ';
    let payload: Record<string, unknown>;

    if (message.list) {
      // Interactive list message (up to 10 rows)
      payload = {
        ...base,
        type: 'interactive',
        interactive: {
          type: 'list',
          ...(message.list.header ? { header: { type: 'text', text: message.list.header.slice(0, 60) } } : {}),
          body: { text: body.slice(0, 1024) },
          action: {
            button: message.list.button.slice(0, 20),
            sections: [{
              rows: message.list.items.map((it) => ({
                id: it.id.slice(0, 200),
                title: it.title.slice(0, 24),
                ...(it.description ? { description: it.description.slice(0, 72) } : {}),
              })),
            }],
          },
        },
      };
    } else if (message.buttons && message.buttons.length > 0) {
      // Interactive reply buttons (up to 3)
      payload = {
        ...base,
        type: 'interactive',
        interactive: {
          type: 'button',
          body: { text: body.slice(0, 1024) },
          action: {
            buttons: message.buttons.slice(0, 3).map((b) => ({
              type: 'reply',
              reply: { id: b.id.slice(0, 256), title: b.title.slice(0, 20) },
            })),
          },
        },
      };
    } else if (message.cta) {
      // Call-to-action URL button (e.g. payment link)
      payload = {
        ...base,
        type: 'interactive',
        interactive: {
          type: 'cta_url',
          body: { text: body.slice(0, 1024) },
          action: { name: 'cta_url', parameters: { display_text: message.cta.label.slice(0, 20), url: message.cta.url } },
        },
      };
    } else if (message.type === 'template') {
      const parameters = message.templateParams
        ? Object.entries(message.templateParams).map(([_, val]) => ({ type: 'text', text: val }))
        : [];
      payload = {
        ...base,
        type: 'template',
        template: {
          name: message.templateKey,
          language: { code: 'en' },
          components: parameters.length > 0 ? [{ type: 'body', parameters }] : [],
        },
      };
    } else {
      payload = { ...base, type: 'text', text: { body } };
    }

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errText = await response.text();
        logger.error('Meta Cloud API error response', {
          status: response.status,
          response: errText,
          organizationId,
        });
        return {
          success: false,
          error: `Meta API returned HTTP ${response.status}: ${errText}`,
        };
      }

      const resData = (await response.json()) as { messages?: Array<{ id: string }> };
      const providerMessageId = resData.messages?.[0]?.id;

      logger.info('Meta Cloud API message sent successfully', {
        organizationId,
        providerMessageId,
      });

      return {
        success: true,
        providerMessageId,
      };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error('Meta Cloud API communication error', { error: errorMsg, organizationId });
      return {
        success: false,
        error: `Failed to communicate with Meta API: ${errorMsg}`,
      };
    }
  }

  /** Send a voice note: upload the audio to WhatsApp media, then send it as an audio message. */
  async sendVoiceNote(organizationId: string, params: { to: string; audioBase64: string; mimeType?: string; idempotencyKey?: string }): Promise<SendResult> {
    if (!this.accessToken || !this.phoneNumberId) {
      return { success: false, error: 'Meta credentials missing.' };
    }
    const mime = (params.mimeType ?? 'audio/ogg').split(';')[0]!.trim() || 'audio/ogg';
    try {
      // 1) Upload the audio to WhatsApp media (multipart).
      const form = new FormData();
      form.append('messaging_product', 'whatsapp');
      form.append('type', mime);
      form.append('file', new Blob([Buffer.from(params.audioBase64, 'base64')], { type: mime }), 'reply.ogg');
      const upRes = await fetch(`https://graph.facebook.com/v21.0/${this.phoneNumberId}/media`, {
        method: 'POST', headers: { Authorization: `Bearer ${this.accessToken}` }, body: form,
      });
      if (!upRes.ok) return { success: false, error: `Meta media upload HTTP ${upRes.status}: ${(await upRes.text().catch(() => '')).slice(0, 200)}` };
      const up = (await upRes.json()) as { id?: string };
      if (!up.id) return { success: false, error: 'Meta media upload returned no id' };

      // 2) Send the audio message referencing the uploaded media.
      const res = await fetch(`https://graph.facebook.com/v21.0/${this.phoneNumberId}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to: params.to, type: 'audio', audio: { id: up.id } }),
      });
      if (!res.ok) return { success: false, error: `Meta audio send HTTP ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}` };
      const data = (await res.json()) as { messages?: Array<{ id: string }> };
      logger.info('Meta voice note sent', { organizationId, providerMessageId: data.messages?.[0]?.id });
      return { success: true, providerMessageId: data.messages?.[0]?.id };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}
