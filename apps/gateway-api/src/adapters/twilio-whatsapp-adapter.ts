import { createHmac, timingSafeEqual } from 'crypto';
import type { WhatsAppAdapter, InboundMessage, OutboundMessage, SendResult } from './types';
import { logger } from '@business-os-ai/shared-types';

/**
 * Twilio WhatsApp adapter.
 *
 * Works with the Twilio WhatsApp Sandbox (instant, no business verification) or
 * a full Twilio WhatsApp Sender. Inbound webhooks are form-encoded; signature
 * verification uses the Twilio X-Twilio-Signature (HMAC-SHA1 of URL + sorted params).
 *
 * Required config:
 * - accountSid  (TWILIO_ACCOUNT_SID)
 * - authToken   (TWILIO_AUTH_TOKEN)
 * - fromNumber  (TWILIO_WHATSAPP_NUMBER, e.g. +14155238886 for the sandbox)
 */
export class TwilioWhatsAppAdapter implements WhatsAppAdapter {
  private readonly accountSid: string;
  private readonly authToken: string;
  private readonly fromNumber: string;

  constructor(config: { accountSid: string; authToken: string; fromNumber: string }) {
    this.accountSid = config.accountSid;
    this.authToken = config.authToken;
    // Normalise: strip any existing "whatsapp:" prefix, keep E.164
    this.fromNumber = config.fromNumber.replace(/^whatsapp:/, '');
  }

  /** Twilio has no GET verification handshake; kept for interface parity. */
  verifyWebhook(_token: string, challenge: string): string | null {
    return challenge;
  }

  parseInboundEvent(body: unknown): InboundMessage[] {
    const form = (body ?? {}) as Record<string, string>;
    const sid = form['MessageSid'] ?? form['SmsMessageSid'] ?? form['SmsSid'];
    const from = form['From'];
    if (!sid || !from) {
      return [];
    }
    // Twilio status callbacks (delivered/read) have MessageStatus but no Body/inbound content
    if (form['MessageStatus'] && !form['Body'] && !form['NumMedia']) {
      return [];
    }

    const numMedia = parseInt(form['NumMedia'] ?? '0', 10);
    let type: InboundMessage['type'] = 'text';
    let mediaUrl: string | undefined;
    if (numMedia > 0) {
      const contentType = form['MediaContentType0'] ?? '';
      type = contentType.startsWith('image/') ? 'image' : 'document';
      mediaUrl = form['MediaUrl0'];
    }

    return [{
      providerMessageId: sid,
      from: from.replace(/^whatsapp:/, ''),
      timestamp: new Date(),
      type,
      text: form['Body'] || undefined,
      mediaUrl,
      metadata: {
        senderName: form['ProfileName'],
        waId: form['WaId'],
        channel: 'twilio',
        to: form['To']?.replace(/^whatsapp:/, ''),
      },
    }];
  }

  async sendMessage(organizationId: string, message: OutboundMessage): Promise<SendResult> {
    // The Twilio Sandbox and unregistered senders don't render native
    // interactive UI, so buttons/list/cta are flattened into readable text
    // (the customer replies naturally; the NL agent handles the choice).
    // A registered sender can later map these to Content templates.
    const bodyText = renderTwilioBody(message);
    if (!bodyText) {
      return { success: false, error: 'Twilio adapter: empty message body.' };
    }

    const url = `https://api.twilio.com/2010-04-01/Accounts/${this.accountSid}/Messages.json`;
    const params = new URLSearchParams({
      From: `whatsapp:${this.fromNumber}`,
      To: `whatsapp:${message.to.replace(/^whatsapp:/, '')}`,
      Body: bodyText,
    });
    const auth = Buffer.from(`${this.accountSid}:${this.authToken}`).toString('base64');

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params.toString(),
      });

      const data = (await response.json()) as { sid?: string; message?: string; code?: number };
      if (!response.ok) {
        logger.error('Twilio API error', { status: response.status, message: data.message, code: data.code, organizationId });
        return { success: false, error: `Twilio API ${response.status}: ${data.message ?? 'unknown error'}` };
      }

      logger.info('Twilio WhatsApp message sent', { organizationId, sid: data.sid });
      return { success: true, providerMessageId: data.sid };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error('Twilio communication error', { error: errorMsg, organizationId });
      return { success: false, error: `Failed to reach Twilio: ${errorMsg}` };
    }
  }

  /**
   * Validates the Twilio request signature.
   * @param url   The exact public URL Twilio was configured to call.
   * @param params The POST form parameters (as a flat string map).
   * @param signature The X-Twilio-Signature header value.
   */
  /** Exposed for tests. */
  static renderBody(message: OutboundMessage): string {
    return renderTwilioBody(message);
  }

  verifySignature(url: string, params: Record<string, string>, signature: string | undefined): boolean {
    if (!signature) return false;
    // Twilio: URL + each POST param (sorted by key) concatenated as key+value, HMAC-SHA1, base64.
    const data = Object.keys(params)
      .sort()
      .reduce((acc, key) => acc + key + params[key], url);
    const expected = createHmac('sha1', this.authToken).update(Buffer.from(data, 'utf-8')).digest('base64');
    try {
      const a = Buffer.from(signature);
      const b = Buffer.from(expected);
      return a.length === b.length && timingSafeEqual(a, b);
    } catch {
      return false;
    }
  }
}

/**
 * Flattens a rich outbound message into WhatsApp-friendly text for providers
 * without native interactive rendering (Twilio sandbox / unregistered senders).
 */
function renderTwilioBody(message: OutboundMessage): string {
  const parts: string[] = [];
  if (message.text) parts.push(message.text.trim());

  if (message.list) {
    const lines: string[] = [];
    if (message.list.header) lines.push(`*${message.list.header}*`);
    message.list.items.forEach((it, i) => {
      lines.push(`${i + 1}. *${it.title}*${it.description ? ` — ${it.description}` : ''}`);
    });
    lines.push(`\n_Reply with the name or number to choose._`);
    parts.push(lines.join('\n'));
  } else if (message.buttons && message.buttons.length > 0) {
    parts.push(message.buttons.map((b) => `▸ ${b.title}`).join('\n'));
  }

  if (message.cta) {
    parts.push(`${message.cta.label}: ${message.cta.url}`);
  }

  return parts.filter(Boolean).join('\n\n');
}
