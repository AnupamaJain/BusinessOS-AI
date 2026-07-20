import { randomUUID } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '@business-os-ai/shared-types';
import { SecretBox, maskPhone } from './crypto';
import type {
  BusinessStore, BusinessSummary, WhatsAppConnection, ContactRecord, ConsentRow, LeadRecord, HandoffRecord,
  MessageRecord, AuditEventRecord, AutomationRunRecord, ConversationRecord,
  ProductRecord, TemplateRecord, OrderRecord, PackageRecord, BookingRecord,
} from './store';

/**
 * Production BusinessStore backed by Supabase Postgres.
 *
 * Uses the service-role client; tenant scope is enforced programmatically on
 * every query (organization_id filter) since service role bypasses RLS.
 */
export class SupabaseBusinessStore implements BusinessStore {
  private readonly box: SecretBox;
  constructor(private readonly db: SupabaseClient, encryptionKey?: string) {
    this.box = new SecretBox(encryptionKey);
  }

  private fail(op: string, error: { message: string } | null): never {
    logger.error(`SupabaseBusinessStore.${op} failed`, { error: error?.message });
    throw new Error(`Database operation failed: ${op}: ${error?.message}`);
  }

  // ─── WhatsApp connections (multi-tenant Embedded Signup) ──────────

  async getWhatsAppConnectionByPhoneId(phoneNumberId: string): Promise<WhatsAppConnection | null> {
    const { data, error } = await this.db.from('whatsapp_connections')
      .select('organization_id, waba_id, phone_number_id, display_phone_number, access_token')
      .eq('phone_number_id', phoneNumberId).eq('status', 'active').maybeSingle();
    if (error) this.fail('getWhatsAppConnectionByPhoneId', error);
    if (!data) return null;
    return {
      organizationId: data.organization_id, wabaId: data.waba_id ?? undefined,
      phoneNumberId: data.phone_number_id, displayPhoneNumber: data.display_phone_number ?? undefined,
      accessToken: this.box.decrypt(data.access_token),
    };
  }

  async saveWhatsAppConnection(conn: WhatsAppConnection & { connectedBy?: string; verifiedName?: string }): Promise<void> {
    const { error } = await this.db.from('whatsapp_connections').upsert({
      organization_id: conn.organizationId, provider: 'meta', waba_id: conn.wabaId,
      phone_number_id: conn.phoneNumberId, display_phone_number: conn.displayPhoneNumber,
      verified_name: conn.verifiedName, access_token: this.box.encrypt(conn.accessToken), status: 'active',
      connected_by: conn.connectedBy,
    }, { onConflict: 'provider,phone_number_id' });
    if (error) this.fail('saveWhatsAppConnection', error);
  }

  // ─── Owner assistant ──────────────────────────────────────────────

  async getOwnerPhoneNumbers(organizationId: string): Promise<string[]> {
    const { data, error } = await this.db.from('organizations')
      .select('settings').eq('id', organizationId).maybeSingle();
    if (error) this.fail('getOwnerPhoneNumbers', error);
    const raw = (data?.settings as Record<string, unknown> | null)?.['owner_whatsapp_numbers'];
    if (!Array.isArray(raw)) return [];
    return raw.map((n) => String(n).trim()).filter(Boolean).map((n) => (n.startsWith('+') ? n : `+${n}`));
  }

  async getBusinessSummary(organizationId: string, now: Date): Promise<BusinessSummary> {
    const startOfDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
    const staleCutoff = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString();
    const activeStages = ['new', 'contacted', 'qualified', 'proposal', 'negotiation'];

    const countOf = async (build: (q: any) => any): Promise<number> => {
      const { count, error } = await build(this.db.from('leads').select('id', { count: 'exact', head: true }).eq('organization_id', organizationId));
      if (error) this.fail('getBusinessSummary.count', error);
      return count ?? 0;
    };

    const todayEnquiries = await countOf((q) => q.gte('created_at', startOfDay));
    const qualifiedLeads = await countOf((q) => q.eq('stage', 'qualified'));

    const { data: hotRows, error: hotErr } = await this.db.from('leads')
      .select('service_interest, score, contact_id, updated_at, stage, contacts(name)')
      .eq('organization_id', organizationId).gte('score', 70).in('stage', activeStages)
      .order('score', { ascending: false }).limit(10);
    if (hotErr) this.fail('getBusinessSummary.hot', hotErr);
    const hot = hotRows ?? [];

    const { data: staleRows, error: staleErr } = await this.db.from('leads')
      .select('service_interest, contact_id, updated_at, stage, contacts(name, phone_number, phone_enc)')
      .eq('organization_id', organizationId).in('stage', activeStages)
      .lt('updated_at', staleCutoff).order('updated_at', { ascending: true }).limit(10);
    if (staleErr) this.fail('getBusinessSummary.stale', staleErr);
    const stale = staleRows ?? [];

    const { count: pendingPayments } = await this.db.from('orders')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', organizationId).eq('status', 'pending_payment');

    // Rough pipeline value: unpaid bookings + pending orders
    const { data: bookings } = await this.db.from('bookings')
      .select('total_amount, status').eq('organization_id', organizationId).in('status', ['pending', 'confirmed']);
    const { data: orders } = await this.db.from('orders')
      .select('total_amount, status').eq('organization_id', organizationId).eq('status', 'pending_payment');
    const pipeline = [...(bookings ?? []), ...(orders ?? [])].reduce((sum, r) => sum + Number(r.total_amount ?? 0), 0);
    const pipelineText = pipeline > 0 ? `₹${pipeline.toLocaleString('en-IN')}` : '—';

    const nameOf = (r: any): string | undefined => (r.contacts as { name?: string } | null)?.name ?? undefined;
    const phoneOf = (r: any): string | undefined => {
      const c = r.contacts as { phone_number?: string | null; phone_enc?: string | null } | null;
      if (!c) return undefined;
      // Decrypt the real number so re-engagement can actually message them.
      return this.realPhone(c) || undefined;
    };

    return {
      todayEnquiries,
      hotLeads: hot.length,
      qualifiedLeads,
      pendingPayments: pendingPayments ?? 0,
      staleLeads: stale.length,
      pipelineText,
      topHotLeads: hot.slice(0, 5).map((r) => ({ name: nameOf(r), serviceInterest: r.service_interest, score: r.score ?? undefined })),
      staleContacts: stale.map((r) => ({ contactId: r.contact_id, phone: phoneOf(r), name: nameOf(r), serviceInterest: r.service_interest, lastActivity: r.updated_at })),
    };
  }

  // ─── Contacts & consent ───────────────────────────────────────────

  /** Normalize a phone to an E.164-ish form: trim + ensure a leading `+`. */
  private normalizePhone(phone: string): string {
    const trimmed = (phone ?? '').trim();
    return trimmed.startsWith('+') ? trimmed : `+${trimmed}`;
  }

  /**
   * The real (decrypted) phone for a contacts row. When encryption is enabled,
   * `phone_number` holds only a mask, so the real value lives in `phone_enc`.
   * Legacy (un-backfilled) rows have no `phone_enc` and keep the real number in
   * `phone_number`.
   */
  private realPhone(row: { phone_number?: string | null; phone_enc?: string | null }): string {
    return row.phone_enc ? this.box.decrypt(row.phone_enc) : (row.phone_number ?? '');
  }

  /**
   * Columns to write for a contact's phone. When the box is enabled the real
   * number is encrypted (`phone_enc`), indexed for equality lookups
   * (`phone_bidx`), and `phone_number` is stored masked. When disabled, the raw
   * phone is stored as before so local/dev is unchanged.
   */
  private phoneWriteFields(normalized: string): { phone_number: string; phone_enc?: string; phone_bidx?: string } {
    if (!this.box.enabled) return { phone_number: normalized };
    return {
      phone_number: maskPhone(normalized),
      phone_enc: this.box.encrypt(normalized),
      phone_bidx: this.box.blindIndex(normalized) ?? undefined,
    };
  }

  async findContactById(organizationId: string, contactId: string): Promise<ContactRecord | undefined> {
    const { data, error } = await this.db.from('contacts')
      .select('id, organization_id, phone_number, phone_enc, name, email')
      .eq('organization_id', organizationId).eq('id', contactId).maybeSingle();
    if (error) this.fail('findContactById', error);
    return data ? { id: data.id, organizationId: data.organization_id, phone: this.realPhone(data), name: data.name ?? undefined, email: data.email ?? undefined } : undefined;
  }

  async findContactByPhone(organizationId: string, phone: string): Promise<ContactRecord | undefined> {
    const normalized = this.normalizePhone(phone);
    const select = 'id, organization_id, phone_number, phone_enc, name, email';

    // Encrypted lookup: match on the keyed blind index (phone_number is masked).
    if (this.box.enabled) {
      const bidx = this.box.blindIndex(normalized);
      if (bidx) {
        const { data, error } = await this.db.from('contacts')
          .select(select)
          .eq('organization_id', organizationId).eq('phone_bidx', bidx).maybeSingle();
        if (error) this.fail('findContactByPhone', error);
        if (data) return { id: data.id, organizationId: data.organization_id, phone: this.realPhone(data), name: data.name ?? undefined, email: data.email ?? undefined };
      }
      // Fall through to the plaintext lookup for legacy rows not yet backfilled.
    }

    const { data, error } = await this.db.from('contacts')
      .select(select)
      .eq('organization_id', organizationId).eq('phone_number', normalized).maybeSingle();
    if (error) this.fail('findContactByPhone', error);
    return data ? { id: data.id, organizationId: data.organization_id, phone: this.realPhone(data), name: data.name ?? undefined, email: data.email ?? undefined } : undefined;
  }

  async upsertContactByPhone(organizationId: string, phone: string, name?: string): Promise<ContactRecord> {
    const normalized = this.normalizePhone(phone);
    // Dedupe against the blind index (when enabled) / plaintext, never the mask.
    const existing = await this.findContactByPhone(organizationId, normalized);
    if (existing) return existing;
    const { data, error } = await this.db.from('contacts')
      .insert({ organization_id: organizationId, name, ...this.phoneWriteFields(normalized) })
      .select('id, organization_id, phone_number, phone_enc, name').single();
    if (error || !data) this.fail('upsertContactByPhone', error);
    // Return the REAL phone to server-side callers, not the stored mask.
    return { id: data.id, organizationId: data.organization_id, phone: normalized, name: data.name ?? undefined };
  }

  async listConsent(organizationId: string, contactId: string): Promise<ConsentRow[]> {
    const { data, error } = await this.db.from('consent_records')
      .select('contact_id, organization_id, consent_type, action, recorded_at')
      .eq('organization_id', organizationId).eq('contact_id', contactId)
      .order('recorded_at', { ascending: true });
    if (error) this.fail('listConsent', error);
    return (data ?? []).map((r) => ({ contactId: r.contact_id, organizationId: r.organization_id, consentType: r.consent_type, action: r.action }));
  }

  async insertConsent(row: ConsentRow & { source?: string }): Promise<void> {
    const { error } = await this.db.from('consent_records').insert({
      organization_id: row.organizationId, contact_id: row.contactId,
      consent_type: row.consentType, action: row.action, source: row.source ?? 'whatsapp_conversation',
    });
    if (error) this.fail('insertConsent', error);
  }

  // ─── Leads ────────────────────────────────────────────────────────

  private mapLead(r: Record<string, any>): LeadRecord {
    return {
      id: r.id, organizationId: r.organization_id, contactId: r.contact_id, conversationId: r.conversation_id,
      stage: r.stage, serviceInterest: r.service_interest, budgetRange: r.budget_range ?? undefined,
      purchaseTimeline: r.purchase_timeline ?? undefined, qualificationSummary: r.qualification_summary ?? undefined,
      score: r.score ?? undefined, idempotencyKey: r.idempotency_key,
    };
  }

  async latestLeadForContact(organizationId: string, contactId: string): Promise<LeadRecord | undefined> {
    const { data, error } = await this.db.from('leads').select('*')
      .eq('organization_id', organizationId).eq('contact_id', contactId)
      .order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (error) this.fail('latestLeadForContact', error);
    return data ? this.mapLead(data) : undefined;
  }

  async findLeadByIdempotencyKey(organizationId: string, idempotencyKey: string): Promise<LeadRecord | undefined> {
    const { data, error } = await this.db.from('leads').select('*')
      .eq('organization_id', organizationId).eq('idempotency_key', idempotencyKey).maybeSingle();
    if (error) this.fail('findLeadByIdempotencyKey', error);
    return data ? this.mapLead(data) : undefined;
  }

  async insertLead(lead: LeadRecord): Promise<LeadRecord> {
    const { error } = await this.db.from('leads').insert({
      id: lead.id, organization_id: lead.organizationId, contact_id: lead.contactId,
      conversation_id: lead.conversationId, stage: lead.stage, service_interest: lead.serviceInterest,
      budget_range: lead.budgetRange, purchase_timeline: lead.purchaseTimeline,
      qualification_summary: lead.qualificationSummary, score: lead.score, idempotency_key: lead.idempotencyKey,
    });
    if (error) this.fail('insertLead', error);
    return lead;
  }

  async updateLead(organizationId: string, leadId: string, patch: Partial<LeadRecord>): Promise<void> {
    const row: Record<string, unknown> = {};
    if (patch.stage !== undefined) row['stage'] = patch.stage;
    if (patch.serviceInterest !== undefined) row['service_interest'] = patch.serviceInterest;
    if (patch.budgetRange !== undefined) row['budget_range'] = patch.budgetRange;
    if (patch.purchaseTimeline !== undefined) row['purchase_timeline'] = patch.purchaseTimeline;
    if (patch.qualificationSummary !== undefined) row['qualification_summary'] = patch.qualificationSummary;
    if (patch.score !== undefined) row['score'] = patch.score;
    const { error } = await this.db.from('leads').update(row)
      .eq('organization_id', organizationId).eq('id', leadId);
    if (error) this.fail('updateLead', error);
  }

  // ─── Conversations & messages ─────────────────────────────────────

  async getConversation(organizationId: string, conversationId: string): Promise<ConversationRecord | undefined> {
    const { data, error } = await this.db.from('conversations')
      .select('id, organization_id, contact_id, status')
      .eq('organization_id', organizationId).eq('id', conversationId).maybeSingle();
    if (error) this.fail('getConversation', error);
    return data ? { id: data.id, organizationId: data.organization_id, contactId: data.contact_id, status: data.status } : undefined;
  }

  async findOrCreateActiveConversation(organizationId: string, contactId: string): Promise<ConversationRecord> {
    const { data, error } = await this.db.from('conversations')
      .select('id, organization_id, contact_id, status')
      .eq('organization_id', organizationId).eq('contact_id', contactId)
      .in('status', ['active', 'waiting_for_human'])
      .order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (error) this.fail('findOrCreateActiveConversation', error);
    if (data) return { id: data.id, organizationId: data.organization_id, contactId: data.contact_id, status: data.status };

    const { data: created, error: insertErr } = await this.db.from('conversations')
      .insert({ organization_id: organizationId, contact_id: contactId, channel: 'whatsapp', status: 'active' })
      .select('id, organization_id, contact_id, status').single();
    if (insertErr || !created) this.fail('findOrCreateActiveConversation.insert', insertErr);
    return { id: created.id, organizationId: created.organization_id, contactId: created.contact_id, status: created.status };
  }

  async updateConversationStatus(organizationId: string, conversationId: string, status: string): Promise<void> {
    const { error } = await this.db.from('conversations').update({ status })
      .eq('organization_id', organizationId).eq('id', conversationId);
    if (error) this.fail('updateConversationStatus', error);
  }

  async listRecentMessages(organizationId: string, conversationId: string, limit: number): Promise<MessageRecord[]> {
    const { data, error } = await this.db.from('messages')
      .select('direction, content, created_at, organization_id, conversation_id, message_type, provider_message_id')
      .eq('organization_id', organizationId).eq('conversation_id', conversationId)
      .order('created_at', { ascending: false }).limit(limit);
    if (error) this.fail('listRecentMessages', error);
    return (data ?? []).reverse().map((m) => ({
      direction: m.direction, content: m.content, createdAt: m.created_at,
      organizationId: m.organization_id, conversationId: m.conversation_id,
      messageType: m.message_type, providerMessageId: m.provider_message_id ?? undefined,
    }));
  }

  async insertMessage(message: MessageRecord): Promise<void> {
    const { error } = await this.db.from('messages').insert({
      organization_id: message.organizationId, conversation_id: message.conversationId,
      direction: message.direction, message_type: message.messageType ?? 'text',
      content: message.content, provider_message_id: message.providerMessageId,
      created_at: message.createdAt,
    });
    if (error) this.fail('insertMessage', error);
  }

  // ─── Handoffs ─────────────────────────────────────────────────────

  private mapHandoff(r: Record<string, any>): HandoffRecord {
    return {
      id: r.id, organizationId: r.organization_id, conversationId: r.conversation_id, contactId: r.contact_id,
      reason: r.reason, priority: r.priority, status: r.status, summary: r.summary,
      idempotencyKey: r.idempotency_key ?? '',
    };
  }

  async findOpenHandoff(organizationId: string, conversationId: string): Promise<HandoffRecord | undefined> {
    const { data, error } = await this.db.from('handoffs').select('*')
      .eq('organization_id', organizationId).eq('conversation_id', conversationId)
      .in('status', ['pending', 'claimed'])
      .order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (error) this.fail('findOpenHandoff', error);
    return data ? this.mapHandoff(data) : undefined;
  }

  async findHandoffByIdempotencyKey(organizationId: string, idempotencyKey: string): Promise<HandoffRecord | undefined> {
    // handoffs table stores idempotency in summary metadata; dedupe via audit trail instead.
    const { data, error } = await this.db.from('audit_events')
      .select('entity_id')
      .eq('organization_id', organizationId).eq('action', 'handoff_created')
      .eq('details->>idempotencyKey', idempotencyKey).limit(1).maybeSingle();
    if (error) this.fail('findHandoffByIdempotencyKey', error);
    if (!data?.entity_id) return undefined;
    const { data: handoff, error: hErr } = await this.db.from('handoffs').select('*')
      .eq('organization_id', organizationId).eq('id', data.entity_id).maybeSingle();
    if (hErr) this.fail('findHandoffByIdempotencyKey.load', hErr);
    return handoff ? this.mapHandoff(handoff) : undefined;
  }

  async insertHandoff(handoff: HandoffRecord): Promise<HandoffRecord> {
    const { error } = await this.db.from('handoffs').insert({
      id: handoff.id, organization_id: handoff.organizationId, conversation_id: handoff.conversationId,
      contact_id: handoff.contactId, reason: handoff.reason, priority: handoff.priority,
      status: handoff.status, summary: handoff.summary,
    });
    if (error) this.fail('insertHandoff', error);
    // Record the idempotency key on the audit trail (handoffs table has no idempotency column)
    await this.insertAuditEvent({
      id: randomUUID(), organizationId: handoff.organizationId, action: 'handoff_created',
      entityType: 'handoff', entityId: handoff.id, actorType: 'agent',
      details: { idempotencyKey: handoff.idempotencyKey, reason: handoff.reason, priority: handoff.priority },
      createdAt: new Date().toISOString(),
    });
    return handoff;
  }

  // ─── Audit ────────────────────────────────────────────────────────

  async insertAuditEvent(event: AuditEventRecord): Promise<void> {
    const { error } = await this.db.from('audit_events').insert({
      id: event.id, organization_id: event.organizationId, action: event.action,
      entity_type: event.entityType, entity_id: event.entityId || null, actor_type: event.actorType,
      details: event.details, created_at: event.createdAt,
    });
    if (error) this.fail('insertAuditEvent', error);
  }

  // ─── Automation ───────────────────────────────────────────────────

  private mapRun(r: Record<string, any>): AutomationRunRecord {
    return {
      id: r.id, organizationId: r.organization_id, contactId: r.contact_id, conversationId: r.conversation_id,
      templateKey: r.template_key, campaignType: r.campaign_type, idempotencyKey: r.idempotency_key,
      status: r.status, scheduledFor: r.scheduled_for,
    };
  }

  async findAutomationRunByIdempotencyKey(organizationId: string, idempotencyKey: string): Promise<AutomationRunRecord | undefined> {
    const { data, error } = await this.db.from('automation_runs').select('*')
      .eq('organization_id', organizationId).eq('idempotency_key', idempotencyKey).maybeSingle();
    if (error) this.fail('findAutomationRunByIdempotencyKey', error);
    return data ? this.mapRun(data) : undefined;
  }

  async insertAutomationRun(run: AutomationRunRecord): Promise<AutomationRunRecord> {
    const { error } = await this.db.from('automation_runs').insert({
      id: run.id, organization_id: run.organizationId, contact_id: run.contactId,
      conversation_id: run.conversationId, campaign_type: run.campaignType,
      template_key: run.templateKey, idempotency_key: run.idempotencyKey,
      status: run.status, scheduled_for: run.scheduledFor,
    });
    if (error) this.fail('insertAutomationRun', error);
    return run;
  }

  async listDueAutomationRuns(now: Date): Promise<AutomationRunRecord[]> {
    const { data, error } = await this.db.from('automation_runs').select('*')
      .eq('status', 'scheduled').lte('scheduled_for', now.toISOString()).limit(100);
    if (error) this.fail('listDueAutomationRuns', error);
    return (data ?? []).map((r) => this.mapRun(r));
  }

  async updateAutomationRun(organizationId: string, runId: string, patch: Partial<AutomationRunRecord>): Promise<void> {
    const row: Record<string, unknown> = {};
    if (patch.status !== undefined) row['status'] = patch.status;
    if (patch.status === 'sent') row['sent_at'] = new Date().toISOString();
    const { error } = await this.db.from('automation_runs').update(row)
      .eq('organization_id', organizationId).eq('id', runId);
    if (error) this.fail('updateAutomationRun', error);
  }

  // ─── Catalog & orders ─────────────────────────────────────────────

  async searchProducts(organizationId: string, query: string, filters?: { skinType?: string; concern?: string }): Promise<ProductRecord[]> {
    const { data, error } = await this.db.from('products')
      .select('sku, name, description, category, base_price, currency')
      .eq('organization_id', organizationId).eq('status', 'active').limit(200);
    if (error) this.fail('searchProducts', error);

    const rows = (data ?? []).map((p) => ({
      sku: p.sku,
      name: p.name,
      price: `₹${Number(p.base_price).toLocaleString('en-IN')}`,
      skinType: p.description ?? '',
      description: p.description ?? '',
      suitableFor: p.category ?? '',
      organizationId,
      _text: `${p.name} ${p.description ?? ''} ${p.category ?? ''}`.toLowerCase(),
    }));

    const lowered = query.toLowerCase();
    const queryWords = lowered.split(/\W+/).filter((w) => w.length > 2);
    // Known category keywords map a query like "sunscreen" straight to the category.
    const categoryKeywords = ['cleanser', 'serum', 'moisturiser', 'moisturizer', 'sunscreen', 'toner', 'mask', 'cream'];
    const queryCategories = categoryKeywords.filter((c) => lowered.includes(c));

    const scored = rows.map((p) => {
      let score = 0;
      for (const w of queryWords) if (p._text.includes(w)) score += 1;
      // Strong boost when the query names this product's category
      if (queryCategories.some((c) => p.suitableFor.toLowerCase().includes(c) || p._text.includes(c))) score += 5;
      // Soft skin-type boost — never a hard exclusion; "all skin types" always eligible
      if (filters?.skinType) {
        if (p._text.includes(filters.skinType.toLowerCase()) || p._text.includes('all skin types')) score += 2;
      }
      if (filters?.concern && p._text.includes(filters.concern.toLowerCase())) score += 2;
      return { p, score };
    });

    // If the query names a category, only return products in that category (ranked).
    const anyCategoryHit = queryCategories.length > 0 && scored.some((s) => s.score >= 5);
    const matches = scored
      .filter((s) => (anyCategoryHit ? s.score >= 5 : s.score > 0))
      .sort((a, b) => b.score - a.score);

    // Fall back to all active products so the agent can still assist if nothing scored.
    const chosen = matches.length > 0 ? matches.map((s) => s.p) : rows;
    return chosen.map(({ _text, ...rest }) => rest);
  }

  async findTemplate(organizationId: string, templateKey: string): Promise<TemplateRecord | undefined> {
    const { data, error } = await this.db.from('message_templates')
      .select('template_key, organization_id, status, name, content')
      .eq('organization_id', organizationId).eq('template_key', templateKey).maybeSingle();
    if (error) this.fail('findTemplate', error);
    return data ? { templateKey: data.template_key, organizationId: data.organization_id, status: data.status, name: data.name, content: data.content } : undefined;
  }

  async findOrderByNumber(organizationId: string, contactId: string, orderNumber: string): Promise<OrderRecord | undefined> {
    const { data, error } = await this.db.from('orders')
      .select('id, organization_id, contact_id, order_number, status, total_amount, currency, created_at, order_items(title, quantity)')
      .eq('organization_id', organizationId).eq('contact_id', contactId)
      .ilike('order_number', orderNumber).maybeSingle();
    if (error) this.fail('findOrderByNumber', error);
    if (!data) return undefined;
    const items = (data.order_items ?? []).map((i: { title: string; quantity: number }) => `${i.title} x${i.quantity}`).join(', ');
    return {
      id: data.id, organizationId: data.organization_id, contactId: data.contact_id,
      orderNumber: data.order_number, status: data.status,
      totalAmount: `₹${Number(data.total_amount).toLocaleString('en-IN')}`,
      items, estimatedDelivery: '',
    };
  }

  // ─── Travel ───────────────────────────────────────────────────────

  async searchPackages(organizationId: string, filters?: { destination?: string; maxBudgetPerPerson?: number; durationDays?: number }): Promise<PackageRecord[]> {
    const { data, error } = await this.db.from('packages')
      .select('sku, title, duration_days, price_per_person, currency, inclusions, metadata, destinations(name)')
      .eq('organization_id', organizationId).eq('status', 'active').limit(100);
    if (error) this.fail('searchPackages', error);

    return (data ?? [])
      .map((p) => {
        const destination = (p.destinations as unknown as { name: string } | null)?.name
          ?? p.title.split(' ')[0] ?? '';
        return {
          sku: p.sku, title: p.title, destination,
          durationDays: p.duration_days, pricePerPerson: Number(p.price_per_person),
          currency: p.currency, inclusions: (p.inclusions as string[]) ?? [], organizationId,
          metadata: (p.metadata as Record<string, unknown>) ?? {},
        };
      })
      .filter((p) => {
        if (filters?.destination && !(`${p.destination} ${p.title}`.toLowerCase().includes(filters.destination.toLowerCase()))) return false;
        if (filters?.maxBudgetPerPerson && p.pricePerPerson > filters.maxBudgetPerPerson) return false;
        if (filters?.durationDays && p.durationDays > filters.durationDays) return false;
        return true;
      });
  }

  async insertBooking(booking: Omit<BookingRecord, 'id' | 'bookingNumber' | 'status'>): Promise<BookingRecord> {
    const { data: pkg, error: pkgErr } = await this.db.from('packages')
      .select('id').eq('organization_id', booking.organizationId).eq('sku', booking.packageSku).maybeSingle();
    if (pkgErr) this.fail('insertBooking.package', pkgErr);

    const bookingNumber = `BK-${Math.floor(10000 + Math.random() * 90000)}`;
    const { data, error } = await this.db.from('bookings').insert({
      organization_id: booking.organizationId, contact_id: booking.contactId,
      package_id: pkg?.id ?? null, booking_number: bookingNumber,
      travel_date: new Date(booking.travelDate).toISOString(),
      traveler_count: booking.travelerCount, total_amount: booking.totalAmount,
      currency: 'INR', status: 'confirmed', metadata: booking.metadata ?? {},
    }).select('id').single();
    if (error || !data) this.fail('insertBooking', error);

    return { ...booking, id: data.id, bookingNumber, status: 'confirmed', metadata: booking.metadata ?? {} };
  }

  async getPackagesByType(organizationId: string, type: string): Promise<PackageRecord[]> {
    const { data, error } = await this.db.from('packages')
      .select('sku, title, duration_days, price_per_person, currency, inclusions, metadata, destinations(name)')
      .eq('organization_id', organizationId).eq('status', 'active')
      .filter('metadata->>type', 'eq', type).limit(100);
    if (error) this.fail('getPackagesByType', error);

    return (data ?? []).map((p) => {
      const destination = (p.destinations as unknown as { name: string } | null)?.name
        ?? p.title.split(' ')[0] ?? '';
      return {
        sku: p.sku, title: p.title, destination,
        durationDays: p.duration_days, pricePerPerson: Number(p.price_per_person),
        currency: p.currency, inclusions: (p.inclusions as string[]) ?? [], organizationId,
        metadata: (p.metadata as Record<string, unknown>) ?? {},
      };
    });
  }
}
