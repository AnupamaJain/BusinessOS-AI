import type { SupabaseClient } from '@supabase/supabase-js';
import type { SupabaseBusinessStore } from '@business-os-ai/mcp-business-tools';
import type { InboundMessage } from '../adapters/types';
import type { StoredMessage } from './message-service';
import { logger } from '@business-os-ai/shared-types';

/**
 * Durable webhook idempotency backed by the webhook_events table.
 * The UNIQUE (provider, provider_message_id) constraint makes deduplication
 * safe across restarts and horizontally scaled instances.
 */
export class SupabaseIdempotencyService {
  constructor(private readonly db: SupabaseClient, private readonly provider = 'whatsapp') {}

  async tryAcquire(providerMessageId: string): Promise<boolean> {
    const { data, error } = await this.db.from('webhook_events')
      .upsert(
        { provider: this.provider, provider_message_id: providerMessageId, status: 'received' },
        { onConflict: 'provider,provider_message_id', ignoreDuplicates: true },
      )
      .select('id');
    if (error) {
      logger.error('webhook_events dedup failed', { error: error.message });
      // Fail open: better to double-process than to drop customer messages.
      return true;
    }
    return (data ?? []).length > 0;
  }

  async markProcessed(providerMessageId: string, organizationId: string, failed?: string): Promise<void> {
    await this.db.from('webhook_events')
      .update({
        status: failed ? 'failed' : 'processed',
        organization_id: organizationId,
        error: failed ?? null,
        processed_at: new Date().toISOString(),
      })
      .eq('provider', this.provider)
      .eq('provider_message_id', providerMessageId);
  }
}

/**
 * Durable message persistence: resolves the contact by phone number,
 * finds or creates the active conversation, and stores the message row.
 */
export class SupabaseMessageService {
  constructor(private readonly store: SupabaseBusinessStore) {}

  async persistInbound(organizationId: string, inbound: InboundMessage): Promise<StoredMessage> {
    const senderName = (inbound.metadata as Record<string, unknown> | undefined)?.['senderName'] as string | undefined;
    const contact = await this.store.upsertContactByPhone(organizationId, normalisePhone(inbound.from), senderName);
    const conversation = await this.store.findOrCreateActiveConversation(organizationId, contact.id);

    await this.store.insertMessage({
      organizationId,
      conversationId: conversation.id,
      direction: 'inbound',
      messageType: inbound.type,
      content: inbound.text ?? `[${inbound.type}]`,
      providerMessageId: inbound.providerMessageId,
      createdAt: inbound.timestamp.toISOString(),
    });

    logger.info('Inbound message persisted', {
      organizationId,
      providerMessageId: inbound.providerMessageId,
      conversationId: conversation.id,
    });

    return {
      id: inbound.providerMessageId,
      organizationId,
      conversationId: conversation.id,
      contactId: contact.id,
      contactPhone: contact.phone,
      direction: 'inbound',
      messageType: inbound.type,
      content: inbound.text ?? '',
      providerMessageId: inbound.providerMessageId,
      createdAt: inbound.timestamp,
    };
  }

  async persistOutbound(
    organizationId: string,
    to: string,
    content: string,
    providerMessageId: string,
    conversationId?: string,
  ): Promise<StoredMessage> {
    let convId = conversationId;
    const contact = await this.store.upsertContactByPhone(organizationId, normalisePhone(to));
    if (!convId) {
      const conversation = await this.store.findOrCreateActiveConversation(organizationId, contact.id);
      convId = conversation.id;
    }

    await this.store.insertMessage({
      organizationId,
      conversationId: convId,
      direction: 'outbound',
      messageType: 'text',
      content,
      providerMessageId,
      createdAt: new Date().toISOString(),
    });

    return {
      id: providerMessageId,
      organizationId,
      conversationId: convId,
      contactId: contact.id,
      contactPhone: to,
      direction: 'outbound',
      messageType: 'text',
      content,
      providerMessageId,
      createdAt: new Date(),
    };
  }
}

/** WhatsApp sends numbers without '+'; contacts table stores E.164 with '+'. */
export function normalisePhone(phone: string): string {
  return phone.startsWith('+') ? phone : `+${phone}`;
}
