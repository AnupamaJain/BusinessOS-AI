import type { InboundMessage } from '../adapters/types';
import { logger } from '@business-os-ai/shared-types';

/**
 * Message persistence service.
 * In MVP, stores messages in memory. Designed for Supabase replacement.
 */
export interface StoredMessage {
  id: string;
  organizationId: string;
  conversationId?: string;
  contactPhone: string;
  direction: 'inbound' | 'outbound';
  messageType: string;
  content: string;
  providerMessageId: string;
  createdAt: Date;
}

export class MessageService {
  private readonly messages: StoredMessage[] = [];
  private idCounter = 0;

  async persistInbound(organizationId: string, inbound: InboundMessage): Promise<StoredMessage> {
    const stored: StoredMessage = {
      id: `msg_${++this.idCounter}`,
      organizationId,
      contactPhone: inbound.from,
      direction: 'inbound',
      messageType: inbound.type,
      content: inbound.text ?? '',
      providerMessageId: inbound.providerMessageId,
      createdAt: inbound.timestamp,
    };
    this.messages.push(stored);
    logger.info('Message persisted', {
      organizationId,
      providerMessageId: inbound.providerMessageId,
    });
    return stored;
  }

  async persistOutbound(organizationId: string, to: string, content: string, providerMessageId: string): Promise<StoredMessage> {
    const stored: StoredMessage = {
      id: `msg_${++this.idCounter}`,
      organizationId,
      contactPhone: to,
      direction: 'outbound',
      messageType: 'text',
      content,
      providerMessageId,
      createdAt: new Date(),
    };
    this.messages.push(stored);
    return stored;
  }

  getMessages(): StoredMessage[] {
    return [...this.messages];
  }

  getMessagesByOrg(organizationId: string): StoredMessage[] {
    return this.messages.filter((m) => m.organizationId === organizationId);
  }

  getByProviderMessageId(providerMessageId: string): StoredMessage | undefined {
    return this.messages.find((m) => m.providerMessageId === providerMessageId);
  }

  clear(): void {
    this.messages.length = 0;
    this.idCounter = 0;
  }
}
