import type { WhatsAppAdapter, InboundMessage, OutboundMessage, SendResult } from './types';
import { logger } from '@whatsapp-smb/shared-types';

/**
 * Meta Cloud API adapter skeleton.
 * Does NOT send real messages until proper configuration exists.
 * Documents required setup in README.
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
    // Same parsing logic as MockWhatsAppAdapter — reuses Meta webhook schema
    // Full implementation deferred until Meta configuration exists
    const { MockWhatsAppAdapter } = require('./mock-whatsapp-adapter');
    const mock = new MockWhatsAppAdapter(this.verifyToken) as WhatsAppAdapter;
    return mock.parseInboundEvent(body);
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
    let payload: Record<string, unknown> = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: message.to,
    };

    if (message.type === 'text') {
      payload = {
        ...payload,
        type: 'text',
        text: {
          body: message.text,
        },
      };
    } else if (message.type === 'template') {
      const parameters = message.templateParams
        ? Object.entries(message.templateParams).map(([_, val]) => ({
            type: 'text',
            text: val,
          }))
        : [];

      payload = {
        ...payload,
        type: 'template',
        template: {
          name: message.templateKey,
          language: {
            code: 'en',
          },
          components: parameters.length > 0
            ? [
                {
                  type: 'body',
                  parameters,
                },
              ]
            : [],
        },
      };
    } else {
      return {
        success: false,
        error: `Unsupported message type: ${message.type}`,
      };
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
}
