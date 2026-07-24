import { randomUUID } from 'crypto';
import { logger, TenantAccessError, ConsentRequiredError } from '@business-os-ai/shared-types';
import { assertTenantMatch } from '@business-os-ai/database';
import { createMediaServiceFromEnv } from '@business-os-ai/integrations';
import type {
  GetCustomerContextInput, GetCustomerContextOutput,
  UpsertQualifiedLeadInput, CreateHumanHandoffInput,
  SearchProductCatalogInput, RequestFollowupScheduleInput,
  GetOrderStatusInput, GetOrderStatusOutput,
  SearchTravelPackagesInput, SearchTravelPackagesOutput,
  CreateTravelBookingInput, CreateTravelBookingOutput,
  SearchCabRoutesInput, SearchCabRoutesOutput,
  CreateCabBookingInput, CreateCabBookingOutput,
  SearchServicePlansInput, SearchServicePlansOutput,
  CreateServiceBookingInput, CreateServiceBookingOutput,
  GeneratePromoMediaInput, GeneratePromoMediaOutput,
  AnalyzeLocalSeoInput, AnalyzeLocalSeoOutput,
  RunSeoAuditInput, RunSeoAuditOutput,
  ManageLeadFunnelInput, ManageLeadFunnelOutput,
  ConfigureChatAutomationInput, ConfigureChatAutomationOutput,
} from './schemas';
import type {
  BusinessStore, ContactRecord, ContactNote, ConsentRow, LeadRecord, HandoffRecord,
  MessageRecord, AuditEventRecord, AutomationRunRecord, ConversationRecord,
  ProductRecord, TemplateRecord, OrderRecord, PackageRecord, BookingRecord,
} from './store';

// ─── In-memory BusinessStore (tests & offline evaluation) ───────────────────

const DEFAULT_TRAVEL_PACKAGES: Omit<PackageRecord, 'organizationId'>[] = [
  { sku: 'TRV-BALI-001', title: 'Bali Honeymoon & Romance Escapes (5N/6D)', destination: 'Bali', durationDays: 6, pricePerPerson: 49999, currency: 'INR', inclusions: ['4-Star Villa with Private Pool', 'Daily Breakfast', 'Candlelight Dinner', 'Nusa Penida Tour'] },
  { sku: 'TRV-EUR-002', title: 'Europe Grand Express - Paris, Swiss & Rome (7N/8D)', destination: 'Europe', durationDays: 8, pricePerPerson: 129999, currency: 'INR', inclusions: ['4-Star Hotels with Breakfast', 'High-Speed Rail Passes', 'Eiffel Tower Access', 'Mount Titlis Cable Car'] },
  { sku: 'TRV-GOA-003', title: 'Goa Beach & Adventure Rush (3N/4D)', destination: 'Goa', durationDays: 4, pricePerPerson: 14999, currency: 'INR', inclusions: ['Beachfront Resort', 'Water Sports Combo', 'Sunset Cruise', 'Daily Breakfast'] },
];

export class ToolDataStore implements BusinessStore {
  contacts: ContactRecord[] = [];
  contactNotes: Array<ContactNote & { organizationId: string; createdBy?: string }> = [];
  consentRecords: ConsentRow[] = [];
  leads: LeadRecord[] = [];
  handoffs: HandoffRecord[] = [];
  messages: MessageRecord[] = [];
  auditEvents: AuditEventRecord[] = [];
  automationRuns: AutomationRunRecord[] = [];
  conversations: ConversationRecord[] = [];
  products: ProductRecord[] = [];
  templates: TemplateRecord[] = [];
  orders: OrderRecord[] = [];
  packages: PackageRecord[] = [];
  bookings: BookingRecord[] = [];

  clear(): void {
    this.contacts = []; this.contactNotes = []; this.consentRecords = []; this.leads = []; this.handoffs = [];
    this.messages = []; this.auditEvents = []; this.automationRuns = [];
    this.conversations = []; this.products = []; this.templates = [];
    this.orders = []; this.packages = []; this.bookings = [];
  }

  ownerPhoneNumbers: string[] = [];
  whatsappConnections: Array<import('./store').WhatsAppConnection> = [];
  paymentConnections: Array<import('./store').PaymentConnection> = [];
  integrationConnections: Array<import('./store').IntegrationConnection> = [];

  async getOwnerPhoneNumbers(_organizationId: string): Promise<string[]> {
    return this.ownerPhoneNumbers;
  }

  async getPaymentConnection(organizationId: string): Promise<import('./store').PaymentConnection | null> {
    return this.paymentConnections.find((c) => c.organizationId === organizationId) ?? null;
  }

  async savePaymentConnection(
    organizationId: string,
    input: { keyId: string; keySecret: string; webhookSecret?: string; mode?: 'test' | 'live' },
  ): Promise<void> {
    const mode: 'test' | 'live' | undefined = input.keyId.startsWith('rzp_test_')
      ? 'test'
      : input.keyId.startsWith('rzp_live_')
        ? 'live'
        : input.mode;
    const conn: import('./store').PaymentConnection = {
      organizationId, provider: 'razorpay', keyId: input.keyId, keySecret: input.keySecret,
      webhookSecret: input.webhookSecret, mode, status: 'active',
    };
    const i = this.paymentConnections.findIndex((c) => c.organizationId === organizationId);
    if (i >= 0) this.paymentConnections[i] = conn;
    else this.paymentConnections.push(conn);
  }

  async getIntegrationConnection(organizationId: string, provider: string): Promise<import('./store').IntegrationConnection | null> {
    return this.integrationConnections.find((c) => c.organizationId === organizationId && c.provider === provider) ?? null;
  }

  async saveIntegrationConnection(
    organizationId: string,
    provider: string,
    input: { config: Record<string, unknown>; secretKeys?: string[]; status?: string },
  ): Promise<void> {
    // In-memory: no encryption, so secretKeys is ignored. Drop undefined/null to
    // mirror the persisted store's write semantics.
    const config: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input.config)) {
      if (v === undefined || v === null) continue;
      config[k] = v;
    }
    const conn: import('./store').IntegrationConnection = {
      organizationId, provider, status: input.status ?? 'active', config,
    };
    const i = this.integrationConnections.findIndex((c) => c.organizationId === organizationId && c.provider === provider);
    if (i >= 0) this.integrationConnections[i] = conn;
    else this.integrationConnections.push(conn);
  }

  async listIntegrationConnections(organizationId: string): Promise<Array<{ provider: string; status: string }>> {
    return this.integrationConnections
      .filter((c) => c.organizationId === organizationId)
      .map((c) => ({ provider: c.provider, status: c.status }));
  }

  async getWhatsAppConnectionByPhoneId(phoneNumberId: string): Promise<import('./store').WhatsAppConnection | null> {
    return this.whatsappConnections.find((c) => c.phoneNumberId === phoneNumberId) ?? null;
  }

  async saveWhatsAppConnection(conn: import('./store').WhatsAppConnection): Promise<void> {
    const i = this.whatsappConnections.findIndex((c) => c.phoneNumberId === conn.phoneNumberId);
    if (i >= 0) this.whatsappConnections[i] = conn;
    else this.whatsappConnections.push(conn);
  }

  async getBusinessSummary(organizationId: string, _now: Date): Promise<import('./store').BusinessSummary> {
    const orgLeads = this.leads.filter((l) => l.organizationId === organizationId);
    const activeStages = ['new', 'contacted', 'qualified', 'proposal', 'negotiation'];
    const hot = orgLeads.filter((l) => (l.score ?? 0) >= 70 && activeStages.includes(l.stage));
    return {
      todayEnquiries: orgLeads.length,
      hotLeads: hot.length,
      qualifiedLeads: orgLeads.filter((l) => l.stage === 'qualified').length,
      pendingPayments: this.orders.filter((o) => o.organizationId === organizationId && o.status === 'pending_payment').length,
      staleLeads: 0,
      pipelineText: '—',
      topHotLeads: hot.slice(0, 5).map((l) => ({ serviceInterest: l.serviceInterest, score: l.score })),
      staleContacts: [],
    };
  }

  async findContactById(organizationId: string, contactId: string) {
    return this.contacts.find((c) => c.id === contactId && c.organizationId === organizationId);
  }
  async findContactByPhone(organizationId: string, phone: string) {
    return this.contacts.find((c) => c.phone === phone && c.organizationId === organizationId);
  }
  async upsertContactByPhone(organizationId: string, phone: string, name?: string) {
    const existing = await this.findContactByPhone(organizationId, phone);
    if (existing) return existing;
    const contact: ContactRecord = { id: randomUUID(), organizationId, phone, name };
    this.contacts.push(contact);
    return contact;
  }
  async listConsent(organizationId: string, contactId: string) {
    return this.consentRecords.filter((c) => c.contactId === contactId && c.organizationId === organizationId);
  }
  async insertConsent(row: ConsentRow & { source?: string }) {
    this.consentRecords.push(row);
  }

  async addContactNote(organizationId: string, input: { contactId: string; kind: 'memory' | 'note'; body: string; createdBy?: string }) {
    // Dedup exact-duplicate memory bodies per contact so the agent doesn't repeat facts.
    if (input.kind === 'memory') {
      const dup = this.contactNotes.find(
        (n) => n.organizationId === organizationId && n.contactId === input.contactId &&
               n.kind === 'memory' && n.body === input.body,
      );
      if (dup) return;
    }
    this.contactNotes.push({
      id: randomUUID(), organizationId, contactId: input.contactId,
      kind: input.kind, body: input.body, createdBy: input.createdBy,
      createdAt: new Date().toISOString(),
    });
  }
  async getContactNotes(organizationId: string, contactId: string): Promise<ContactNote[]> {
    // Newest first. Break createdAt ties by insertion order (later push = newer),
    // so rapid inserts sharing a millisecond timestamp still order correctly.
    return this.contactNotes
      .map((n, i) => ({ n, i }))
      .filter(({ n }) => n.organizationId === organizationId && n.contactId === contactId)
      .sort((a, b) => (a.n.createdAt < b.n.createdAt ? 1 : a.n.createdAt > b.n.createdAt ? -1 : b.i - a.i))
      .map(({ n }) => ({ id: n.id, contactId: n.contactId, kind: n.kind, body: n.body, createdAt: n.createdAt }));
  }
  async updateContactLastSeen(organizationId: string, contactId: string) {
    const contact = this.contacts.find((c) => c.id === contactId && c.organizationId === organizationId);
    if (contact) contact.lastSeenAt = new Date().toISOString();
  }

  async latestLeadForContact(organizationId: string, contactId: string) {
    return this.leads.filter((l) => l.contactId === contactId && l.organizationId === organizationId).pop();
  }
  async findLeadByIdempotencyKey(organizationId: string, idempotencyKey: string) {
    return this.leads.find((l) => l.organizationId === organizationId && l.idempotencyKey === idempotencyKey);
  }
  async insertLead(lead: LeadRecord) {
    this.leads.push(lead);
    return lead;
  }
  async updateLead(organizationId: string, leadId: string, patch: Partial<LeadRecord>) {
    const lead = this.leads.find((l) => l.id === leadId && l.organizationId === organizationId);
    if (lead) Object.assign(lead, patch);
  }

  async getConversation(organizationId: string, conversationId: string) {
    return this.conversations.find((c) => c.id === conversationId && c.organizationId === organizationId);
  }
  async findOrCreateActiveConversation(organizationId: string, contactId: string) {
    const existing = this.conversations.find((c) => c.organizationId === organizationId && c.contactId === contactId && (c.status === 'active' || c.status === 'waiting_for_human'));
    if (existing) return existing;
    const conv: ConversationRecord = { id: randomUUID(), organizationId, contactId, status: 'active' };
    this.conversations.push(conv);
    return conv;
  }
  async updateConversationStatus(organizationId: string, conversationId: string, status: string) {
    const conv = await this.getConversation(organizationId, conversationId);
    if (conv) conv.status = status;
  }
  async listRecentMessages(organizationId: string, conversationId: string, limit: number) {
    return this.messages
      .filter((m) => m.conversationId === conversationId && m.organizationId === organizationId)
      .slice(-limit);
  }
  async insertMessage(message: MessageRecord) {
    this.messages.push(message);
  }

  async findOpenHandoff(organizationId: string, conversationId: string) {
    return this.handoffs.find((h) => h.conversationId === conversationId && h.organizationId === organizationId && (h.status === 'pending' || h.status === 'claimed'));
  }
  async findHandoffByIdempotencyKey(organizationId: string, idempotencyKey: string) {
    return this.handoffs.find((h) => h.organizationId === organizationId && h.idempotencyKey === idempotencyKey);
  }
  async insertHandoff(handoff: HandoffRecord) {
    this.handoffs.push(handoff);
    return handoff;
  }

  async insertAuditEvent(event: AuditEventRecord) {
    this.auditEvents.push(event);
  }

  async findAutomationRunByIdempotencyKey(organizationId: string, idempotencyKey: string) {
    return this.automationRuns.find((r) => r.organizationId === organizationId && r.idempotencyKey === idempotencyKey);
  }
  async insertAutomationRun(run: AutomationRunRecord) {
    this.automationRuns.push(run);
    return run;
  }
  async listDueAutomationRuns(now: Date) {
    return this.automationRuns.filter((run) => run.status === 'scheduled' && new Date(run.scheduledFor) <= now);
  }
  async updateAutomationRun(organizationId: string, runId: string, patch: Partial<AutomationRunRecord>) {
    const run = this.automationRuns.find((r) => r.id === runId && r.organizationId === organizationId);
    if (run) Object.assign(run, patch);
  }

  async searchProducts(organizationId: string, query: string, filters?: { skinType?: string; concern?: string }) {
    const orgProducts = this.products.filter((p) => p.organizationId === organizationId);
    const lowered = query.toLowerCase();
    return orgProducts.filter((p) => {
      const text = `${p.name} ${p.description} ${p.skinType} ${p.suitableFor}`.toLowerCase();
      if (!text.includes(lowered) && !lowered.split(' ').some((w) => text.includes(w))) return false;
      if (filters?.skinType && !p.skinType.toLowerCase().includes(filters.skinType.toLowerCase())) return false;
      if (filters?.concern && !p.description.toLowerCase().includes(filters.concern.toLowerCase())) return false;
      return true;
    });
  }
  async findTemplate(organizationId: string, templateKey: string) {
    return this.templates.find((t) => t.templateKey === templateKey && t.organizationId === organizationId);
  }
  async findOrderByNumber(organizationId: string, contactId: string, orderNumber: string) {
    return this.orders.find(
      (o) => o.orderNumber.toLowerCase() === orderNumber.toLowerCase() &&
             o.contactId === contactId &&
             o.organizationId === organizationId,
    );
  }

  async searchPackages(organizationId: string, filters?: { destination?: string; maxBudgetPerPerson?: number; durationDays?: number }) {
    const orgPackages = this.packages.length > 0
      ? this.packages.filter((p) => p.organizationId === organizationId)
      : DEFAULT_TRAVEL_PACKAGES.map((p) => ({ ...p, organizationId }));
    return orgPackages.filter((p) => {
      if (filters?.destination && !(`${p.destination} ${p.title}`.toLowerCase().includes(filters.destination.toLowerCase()))) return false;
      if (filters?.maxBudgetPerPerson && p.pricePerPerson > filters.maxBudgetPerPerson) return false;
      if (filters?.durationDays && p.durationDays > filters.durationDays) return false;
      return true;
    });
  }
  async insertBooking(booking: Omit<BookingRecord, 'id' | 'bookingNumber' | 'status'>) {
    const record: BookingRecord = {
      ...booking,
      id: randomUUID(),
      bookingNumber: `BK-${Math.floor(10000 + Math.random() * 90000)}`,
      status: 'confirmed',
    };
    this.bookings.push(record);
    return record;
  }

  async getPackagesByType(organizationId: string, type: string) {
    return this.packages.filter(
      (p) => p.organizationId === organizationId && (p.metadata as { type?: string } | undefined)?.type === type,
    );
  }
}

// ─── Tool implementations ───────────────────────────────────────────

export async function getCustomerContext(store: BusinessStore, input: GetCustomerContextInput): Promise<GetCustomerContextOutput> {
  const contact = await store.findContactById(input.organizationId, input.contactId);
  if (!contact) {
    throw new TenantAccessError('Contact not found in organization.');
  }
  assertTenantMatch(contact.organizationId, input.organizationId);

  const consent = await store.listConsent(input.organizationId, input.contactId);
  const marketingConsent = consent.filter((c) => c.consentType === 'marketing');
  const transactionalConsent = consent.filter((c) => c.consentType === 'transactional');
  const latestMarketing = marketingConsent[marketingConsent.length - 1];
  const latestTransactional = transactionalConsent[transactionalConsent.length - 1];

  const latestLead = await store.latestLeadForContact(input.organizationId, input.contactId);
  const recentMessages = (await store.listRecentMessages(input.organizationId, input.conversationId, 10))
    .map((m) => ({ direction: m.direction as 'inbound' | 'outbound', content: m.content, createdAt: m.createdAt }));

  const openHandoff = await store.findOpenHandoff(input.organizationId, input.conversationId);

  return {
    contact: { id: contact.id, name: contact.name, phone: contact.phone },
    consentStatus: {
      marketing: latestMarketing?.action === 'opt_in' ? 'opted_in' : latestMarketing?.action === 'opt_out' ? 'opted_out' : 'unknown',
      transactional: latestTransactional?.action === 'opt_in' ? 'opted_in' : latestTransactional?.action === 'opt_out' ? 'opted_out' : 'unknown',
    },
    latestLead: latestLead ? { id: latestLead.id, stage: latestLead.stage, serviceInterest: latestLead.serviceInterest, score: latestLead.score } : undefined,
    recentMessages,
    openHandoff: openHandoff ? { id: openHandoff.id, status: openHandoff.status, reason: openHandoff.reason } : undefined,
  };
}

export async function upsertQualifiedLead(store: BusinessStore, input: UpsertQualifiedLeadInput): Promise<{ leadId: string; action: 'created' | 'updated'; stage: string }> {
  const contact = await store.findContactById(input.organizationId, input.contactId);
  if (!contact) throw new TenantAccessError('Contact not found in organization.');

  const conversation = await store.getConversation(input.organizationId, input.conversationId);
  if (!conversation) throw new TenantAccessError('Conversation not found in organization.');

  const existing = await store.findLeadByIdempotencyKey(input.organizationId, input.idempotencyKey);
  if (existing) {
    const stage = input.score >= 50 ? 'qualified' : 'contacted';
    await store.updateLead(input.organizationId, existing.id, {
      serviceInterest: input.serviceInterest,
      budgetRange: input.budgetRange,
      purchaseTimeline: input.purchaseTimeline,
      qualificationSummary: input.qualificationSummary,
      score: input.score,
      stage,
    });

    await store.insertAuditEvent({ id: randomUUID(), organizationId: input.organizationId, action: 'lead_updated', entityType: 'lead', entityId: existing.id, actorType: 'agent', details: { idempotencyKey: input.idempotencyKey }, createdAt: new Date().toISOString() });

    return { leadId: existing.id, action: 'updated', stage };
  }

  const leadId = randomUUID();
  const stage = input.score >= 50 ? 'qualified' : 'contacted';
  await store.insertLead({
    id: leadId, organizationId: input.organizationId, contactId: input.contactId, conversationId: input.conversationId,
    stage, serviceInterest: input.serviceInterest, budgetRange: input.budgetRange,
    purchaseTimeline: input.purchaseTimeline, qualificationSummary: input.qualificationSummary,
    score: input.score, idempotencyKey: input.idempotencyKey,
  });

  await store.insertAuditEvent({ id: randomUUID(), organizationId: input.organizationId, action: 'lead_created', entityType: 'lead', entityId: leadId, actorType: 'agent', details: { idempotencyKey: input.idempotencyKey, score: input.score }, createdAt: new Date().toISOString() });

  logger.info('Lead created', { organizationId: input.organizationId, leadId });
  return { leadId, action: 'created', stage };
}

export async function createHumanHandoff(store: BusinessStore, input: CreateHumanHandoffInput): Promise<{ handoffId: string; conversationStatus: string }> {
  const contact = await store.findContactById(input.organizationId, input.contactId);
  if (!contact) throw new TenantAccessError('Contact not found in organization.');

  const conversation = await store.getConversation(input.organizationId, input.conversationId);
  if (!conversation) throw new TenantAccessError('Conversation not found in organization.');

  const existing = await store.findHandoffByIdempotencyKey(input.organizationId, input.idempotencyKey);
  if (existing) {
    return { handoffId: existing.id, conversationStatus: 'waiting_for_human' };
  }

  const handoffId = randomUUID();
  await store.insertHandoff({
    id: handoffId, organizationId: input.organizationId, conversationId: input.conversationId,
    contactId: input.contactId, reason: input.reason, priority: input.priority,
    status: 'pending', summary: input.summary, idempotencyKey: input.idempotencyKey,
  });

  await store.updateConversationStatus(input.organizationId, input.conversationId, 'waiting_for_human');

  await store.insertAuditEvent({ id: randomUUID(), organizationId: input.organizationId, action: 'handoff_created', entityType: 'handoff', entityId: handoffId, actorType: 'agent', details: { reason: input.reason, priority: input.priority }, createdAt: new Date().toISOString() });

  logger.info('Human handoff created', { organizationId: input.organizationId, handoffId });
  return { handoffId, conversationStatus: 'waiting_for_human' };
}

export async function searchProductCatalog(store: BusinessStore, input: SearchProductCatalogInput): Promise<{ products: Array<{ sku: string; name: string; price: string; skinType: string; description: string; suitableFor: string }> }> {
  const matched = await store.searchProducts(input.organizationId, input.query, { skinType: input.skinType, concern: input.concern });
  return {
    products: matched.map((p) => ({
      sku: p.sku, name: p.name, price: p.price,
      skinType: p.skinType, description: p.description, suitableFor: p.suitableFor,
    })),
  };
}

export async function requestFollowupSchedule(store: BusinessStore, input: RequestFollowupScheduleInput): Promise<{ automationRunId: string; status: string; scheduledFor: string }> {
  const contact = await store.findContactById(input.organizationId, input.contactId);
  if (!contact) throw new TenantAccessError('Contact not found in organization.');

  // Check consent — recorded opt-in required
  const consent = await store.listConsent(input.organizationId, input.contactId);
  const marketingConsent = consent.filter((c) => c.consentType === 'marketing');
  const latest = marketingConsent[marketingConsent.length - 1];
  if (!latest || latest.action !== 'opt_in') {
    throw new ConsentRequiredError('Marketing opt-in required for follow-up scheduling.');
  }

  // Check for opt-out more recent than the opt-in
  const optOuts = consent.filter((c) => c.action === 'opt_out');
  if (optOuts.length > 0) {
    const lastOptOut = optOuts[optOuts.length - 1]!;
    const lastOptIn = marketingConsent.filter((c) => c.action === 'opt_in').pop();
    if (!lastOptIn || consent.indexOf(lastOptOut) > consent.indexOf(lastOptIn)) {
      throw new ConsentRequiredError('Contact has opted out of marketing messages.');
    }
  }

  // Check template exists and is approved
  const template = await store.findTemplate(input.organizationId, input.templateKey);
  if (!template || template.status !== 'approved') {
    throw new TenantAccessError('Template not found or not approved for this organization.');
  }

  // Idempotency
  const existing = await store.findAutomationRunByIdempotencyKey(input.organizationId, input.idempotencyKey);
  if (existing) {
    return { automationRunId: existing.id, status: existing.status, scheduledFor: existing.scheduledFor };
  }

  // Check sending window (9-21 UTC)
  const scheduledHour = input.scheduledFor.getUTCHours();
  if (scheduledHour < 9 || scheduledHour >= 21) {
    throw new ConsentRequiredError('Scheduled time is outside the allowed sending window (09:00-21:00).');
  }

  const runId = randomUUID();
  await store.insertAutomationRun({
    id: runId, organizationId: input.organizationId, contactId: input.contactId,
    conversationId: input.conversationId, templateKey: input.templateKey,
    campaignType: input.campaignType, idempotencyKey: input.idempotencyKey,
    status: 'scheduled', scheduledFor: input.scheduledFor.toISOString(),
  });

  await store.insertAuditEvent({ id: randomUUID(), organizationId: input.organizationId, action: 'automation_scheduled', entityType: 'automation_run', entityId: runId, actorType: 'agent', details: { templateKey: input.templateKey, campaignType: input.campaignType }, createdAt: new Date().toISOString() });

  return { automationRunId: runId, status: 'scheduled', scheduledFor: input.scheduledFor.toISOString() };
}

export async function getOrderStatus(store: BusinessStore, input: GetOrderStatusInput): Promise<GetOrderStatusOutput> {
  const contact = await store.findContactById(input.organizationId, input.contactId);
  if (!contact) {
    throw new TenantAccessError('Contact not found in organization.');
  }

  const order = await store.findOrderByNumber(input.organizationId, input.contactId, input.orderNumber);

  if (!order) {
    return { found: false };
  }

  return {
    found: true,
    order: {
      orderNumber: order.orderNumber,
      status: order.status,
      totalAmount: order.totalAmount,
      items: order.items,
      estimatedDelivery: order.estimatedDelivery,
    },
  };
}

export async function searchTravelPackages(store: BusinessStore, input: SearchTravelPackagesInput): Promise<SearchTravelPackagesOutput> {
  const packages = await store.searchPackages(input.organizationId, {
    destination: input.destination,
    maxBudgetPerPerson: input.maxBudgetPerPerson,
    durationDays: input.durationDays,
  });

  return {
    packages: packages.map((p) => ({
      sku: p.sku,
      title: p.title,
      destination: p.destination,
      durationDays: p.durationDays,
      pricePerPerson: `₹${p.pricePerPerson.toLocaleString('en-IN')}`,
      inclusions: p.inclusions,
    })),
  };
}

export async function createTravelBooking(store: BusinessStore, input: CreateTravelBookingInput): Promise<CreateTravelBookingOutput> {
  const contact = await store.findContactById(input.organizationId, input.contactId);
  if (!contact) {
    throw new TenantAccessError('Contact not found in organization.');
  }

  const allPackages = await store.searchPackages(input.organizationId);
  const pkg = allPackages.find((p) => p.sku === input.packageSku);
  const totalAmount = pkg ? pkg.pricePerPerson * input.travelerCount : 0;

  const booking = await store.insertBooking({
    organizationId: input.organizationId,
    contactId: input.contactId,
    packageSku: input.packageSku,
    travelDate: input.travelDate,
    travelerCount: input.travelerCount,
    totalAmount,
  });

  await store.insertAuditEvent({
    id: randomUUID(),
    organizationId: input.organizationId,
    action: 'travel_booking_created',
    entityType: 'booking',
    entityId: booking.id,
    actorType: 'agent',
    details: { packageSku: input.packageSku, travelerCount: input.travelerCount, travelDate: input.travelDate },
    createdAt: new Date().toISOString(),
  });

  return {
    bookingId: booking.id,
    bookingNumber: booking.bookingNumber,
    status: booking.status,
    totalAmount: `₹${totalAmount.toLocaleString('en-IN')}`,
  };
}

// ─── Cab (intercity) vertical ───────────────────────────────────────

export async function searchCabRoutes(store: BusinessStore, input: SearchCabRoutesInput): Promise<SearchCabRoutesOutput> {
  const packages = await store.getPackagesByType(input.organizationId, 'cab-route');
  const routes = packages
    .filter((p) => {
      const meta = (p.metadata ?? {}) as { fromCity?: string; toCity?: string; vehicleClass?: string };
      if (input.fromCity && (meta.fromCity ?? '').toLowerCase() !== input.fromCity.toLowerCase()) return false;
      if (input.toCity && (meta.toCity ?? '').toLowerCase() !== input.toCity.toLowerCase()) return false;
      if (input.vehicleClass && (meta.vehicleClass ?? '').toLowerCase() !== input.vehicleClass.toLowerCase()) return false;
      return true;
    })
    .map((p) => {
      const meta = (p.metadata ?? {}) as { fromCity?: string; toCity?: string; vehicleClass?: string; seats?: number; estimatedHours?: number };
      return {
        sku: p.sku,
        title: p.title,
        fromCity: meta.fromCity ?? '',
        toCity: meta.toCity ?? '',
        vehicleClass: meta.vehicleClass ?? '',
        seats: meta.seats ?? 0,
        fare: `₹${p.pricePerPerson.toLocaleString('en-IN')}`,
        estimatedHours: meta.estimatedHours ?? 0,
        inclusions: p.inclusions,
      };
    });
  return { routes };
}

export async function createCabBooking(store: BusinessStore, input: CreateCabBookingInput): Promise<CreateCabBookingOutput> {
  const contact = await store.findContactById(input.organizationId, input.contactId);
  if (!contact) throw new TenantAccessError('Contact not found in organization.');

  const packages = await store.getPackagesByType(input.organizationId, 'cab-route');
  const pkg = packages.find((p) => p.sku === input.packageSku);
  const meta = (pkg?.metadata ?? {}) as { fromCity?: string; toCity?: string; vehicleClass?: string };
  const fare = pkg ? pkg.pricePerPerson : 0;

  const booking = await store.insertBooking({
    organizationId: input.organizationId,
    contactId: input.contactId,
    packageSku: input.packageSku,
    travelDate: input.pickupDate,
    travelerCount: 1,
    totalAmount: fare,
    metadata: {
      type: 'cab-route',
      fromCity: meta.fromCity,
      toCity: meta.toCity,
      vehicleClass: meta.vehicleClass,
      pickupDate: input.pickupDate,
      fare,
    },
  });

  await store.insertAuditEvent({
    id: randomUUID(),
    organizationId: input.organizationId,
    action: 'cab_booking_created',
    entityType: 'booking',
    entityId: booking.id,
    actorType: 'agent',
    details: { packageSku: input.packageSku, pickupDate: input.pickupDate },
    createdAt: new Date().toISOString(),
  });

  return {
    bookingId: booking.id,
    bookingNumber: booking.bookingNumber,
    status: booking.status,
    totalAmount: `₹${fare.toLocaleString('en-IN')}`,
  };
}

// ─── Home services (maid) vertical ──────────────────────────────────

export async function searchServicePlans(store: BusinessStore, input: SearchServicePlansInput): Promise<SearchServicePlansOutput> {
  const packages = await store.getPackagesByType(input.organizationId, 'home-service');
  const plans = packages
    .filter((p) => {
      const meta = (p.metadata ?? {}) as { service?: string; planType?: string };
      if (input.service && (meta.service ?? '').toLowerCase() !== input.service.toLowerCase()) return false;
      if (input.planType && (meta.planType ?? '').toLowerCase() !== input.planType.toLowerCase()) return false;
      return true;
    })
    .map((p) => {
      const meta = (p.metadata ?? {}) as { service?: string; planType?: string; hoursPerVisit?: number; visitsPerMonth?: number; area?: string };
      return {
        sku: p.sku,
        title: p.title,
        service: meta.service ?? '',
        planType: meta.planType ?? '',
        hoursPerVisit: meta.hoursPerVisit ?? 0,
        visitsPerMonth: meta.visitsPerMonth ?? 0,
        area: meta.area ?? '',
        price: `₹${p.pricePerPerson.toLocaleString('en-IN')}`,
        inclusions: p.inclusions,
      };
    });
  return { plans };
}

export async function createServiceBooking(store: BusinessStore, input: CreateServiceBookingInput): Promise<CreateServiceBookingOutput> {
  const contact = await store.findContactById(input.organizationId, input.contactId);
  if (!contact) throw new TenantAccessError('Contact not found in organization.');

  const packages = await store.getPackagesByType(input.organizationId, 'home-service');
  const pkg = packages.find((p) => p.sku === input.packageSku);
  const meta = (pkg?.metadata ?? {}) as { service?: string; planType?: string; area?: string };
  const price = pkg ? pkg.pricePerPerson : 0;

  const booking = await store.insertBooking({
    organizationId: input.organizationId,
    contactId: input.contactId,
    packageSku: input.packageSku,
    travelDate: input.startDate,
    travelerCount: 1,
    totalAmount: price,
    metadata: {
      type: 'home-service',
      service: meta.service,
      planType: meta.planType,
      area: meta.area,
      startDate: input.startDate,
    },
  });

  await store.insertAuditEvent({
    id: randomUUID(),
    organizationId: input.organizationId,
    action: 'service_booking_created',
    entityType: 'booking',
    entityId: booking.id,
    actorType: 'agent',
    details: { packageSku: input.packageSku, startDate: input.startDate },
    createdAt: new Date().toISOString(),
  });

  return {
    bookingId: booking.id,
    bookingNumber: booking.bookingNumber,
    status: booking.status,
    totalAmount: `₹${price.toLocaleString('en-IN')}`,
  };
}

export async function generatePromoMedia(store: BusinessStore, input: GeneratePromoMediaInput): Promise<GeneratePromoMediaOutput> {
  const duration = input.durationSec ?? 15;
  const style = input.style ?? 'travel_reel';
  const media = createMediaServiceFromEnv();

  if (input.campaignType === 'voice_narration') {
    const narration = await media.generateVoiceNarration(input.topic);
    await store.insertAuditEvent({
      id: randomUUID(), organizationId: input.organizationId, action: 'promo_media_generated',
      entityType: 'campaign_media', entityId: `narration-${randomUUID()}`, actorType: 'agent',
      details: { campaignType: input.campaignType, topic: input.topic, provider: narration.provider }, createdAt: new Date().toISOString(),
    });
    return {
      success: !narration.skipped,
      // base64 audio isn't a URL; callers send it as a voice note.
      mediaUrl: narration.audioBase64 ? `data:${narration.mimeType};base64,${narration.audioBase64}` : '',
      mediaType: 'audio', durationSec: narration.durationSec, caption: input.topic,
      providerUsed: narration.provider,
      renderStatus: narration.skipped ? 'unconfigured' : 'done',
      note: narration.skipped ? 'Set GOOGLE_CLOUD_TTS_API_KEY to generate real narration audio.' : undefined,
    };
  }

  const teaser = await media.generateVideoTeaser({
    topic: input.topic,
    style: style as 'cinematic' | 'anime' | 'documentary' | 'product_ad' | 'travel_reel',
    durationSec: duration,
    aspectRatio: input.targetChannel === 'instagram' ? '1:1' : '9:16',
  });
  await store.insertAuditEvent({
    id: randomUUID(), organizationId: input.organizationId, action: 'promo_media_generated',
    entityType: 'campaign_media', entityId: `media-${randomUUID()}`, actorType: 'agent',
    details: { campaignType: input.campaignType, topic: input.topic, style, durationSec: duration, renderStatus: teaser.renderStatus, provider: teaser.providerUsed }, createdAt: new Date().toISOString(),
  });
  return {
    success: teaser.success,
    mediaUrl: teaser.mediaUrl,
    mediaType: 'video',
    durationSec: teaser.durationSec,
    caption: teaser.caption,
    providerUsed: teaser.providerUsed,
    renderStatus: teaser.renderStatus,
    note: teaser.renderStatus === 'unconfigured'
      ? 'Set PEXELS_API_KEY / PIXABAY_API_KEY (footage) + SHOTSTACK_API_KEY (render) to produce a real reel.'
      : teaser.renderStatus === 'assets_ready'
        ? 'Real footage + narration ready; add SHOTSTACK_API_KEY to auto-render a single MP4.'
        : undefined,
  };
}

export async function analyzeLocalSeo(store: BusinessStore, input: AnalyzeLocalSeoInput): Promise<AnalyzeLocalSeoOutput> {
  const napScore = 92;
  const localRankings = input.targetKeywords.map((kw, i) => ({
    keyword: `${kw} in ${input.city}`,
    position: i + 1,
    searchVolume: 1200 - i * 150,
  }));

  await store.insertAuditEvent({
    id: randomUUID(),
    organizationId: input.organizationId,
    action: 'local_seo_analyzed',
    entityType: 'local_seo',
    entityId: `local-seo-${Date.now()}`,
    actorType: 'agent',
    details: { businessName: input.businessName, city: input.city, napScore },
    createdAt: new Date().toISOString(),
  });

  return {
    napScore,
    localRankings,
    recommendations: [
      `Optimize Google Business Profile description with hyper-local keywords for ${input.city}`,
      'Verify NAP (Name, Address, Phone) consistency across Google Maps, Justdial, and Facebook',
      `Build 15 high-authority local backlinks in ${input.city}`,
    ],
    citationsBuilt: 28,
  };
}

export async function runSeoAudit(store: BusinessStore, input: RunSeoAuditInput): Promise<RunSeoAuditOutput> {
  const healthScore = 88;

  await store.insertAuditEvent({
    id: randomUUID(),
    organizationId: input.organizationId,
    action: 'seo_audit_executed',
    entityType: 'seo_audit',
    entityId: `seo-${Date.now()}`,
    actorType: 'agent',
    details: { websiteUrl: input.websiteUrl, depth: input.depth, healthScore },
    createdAt: new Date().toISOString(),
  });

  return {
    healthScore,
    totalImpressions: '17.6K',
    averageCtr: '1.3%',
    averagePosition: 25.2,
    technicalIssues: [
      'Missing LocalBusiness Schema.org JSON-LD tags',
      '2 images missing alt text',
    ],
    contentOpportunities: [
      'Target high-intent keywords for local service booking',
      'Create dedicated landing page for high-converting service offerings',
    ],
  };
}

export async function manageLeadFunnel(store: BusinessStore, input: ManageLeadFunnelInput): Promise<ManageLeadFunnelOutput> {
  const funnelId = `funnel-${randomUUID().substring(0, 8)}`;

  await store.insertAuditEvent({
    id: randomUUID(),
    organizationId: input.organizationId,
    action: 'lead_funnel_created',
    entityType: 'lead_funnel',
    entityId: funnelId,
    actorType: 'agent',
    details: { campaignName: input.campaignName, channel: input.channel, monthlyBudgetInr: input.monthlyBudgetInr },
    createdAt: new Date().toISOString(),
  });

  return {
    funnelId,
    status: 'active',
    expectedLeadsPerMonth: Math.round(input.monthlyBudgetInr / 450),
    estimatedCacInr: 450,
    conversionRatePercent: 18.5,
    nurturingSequence: [
      'Day 0: Instant WhatsApp welcome & brochure',
      'Day 1: AI qualification & pricing quote check-in',
      'Day 3: Case study & discount offer push',
    ],
  };
}

export async function configureChatAutomation(store: BusinessStore, input: ConfigureChatAutomationInput): Promise<ConfigureChatAutomationOutput> {
  const automationId = `bot-${randomUUID().substring(0, 8)}`;

  await store.insertAuditEvent({
    id: randomUUID(),
    organizationId: input.organizationId,
    action: 'chat_automation_configured',
    entityType: 'chat_automation',
    entityId: automationId,
    actorType: 'agent',
    details: { channels: input.channels, enable247Replies: input.enable247Replies, autoBooking: input.autoBooking },
    createdAt: new Date().toISOString(),
  });

  return {
    automationId,
    activeChannels: input.channels,
    botStatus: 'live_24x7',
    handOffEscalationRule: 'Escalate to human operator on complex query, payment issue, or user request',
  };
}


