import { randomUUID } from 'crypto';
import { logger, TenantAccessError, ConsentRequiredError } from '@business-os-ai/shared-types';
import { assertTenantMatch } from '@business-os-ai/database';
import type {
  GetCustomerContextInput, GetCustomerContextOutput,
  UpsertQualifiedLeadInput, CreateHumanHandoffInput,
  SearchProductCatalogInput, RequestFollowupScheduleInput,
  GetOrderStatusInput, GetOrderStatusOutput,
  SearchTravelPackagesInput, SearchTravelPackagesOutput,
  CreateTravelBookingInput, CreateTravelBookingOutput,
} from './schemas';
import type {
  BusinessStore, ContactRecord, ConsentRow, LeadRecord, HandoffRecord,
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
    this.contacts = []; this.consentRecords = []; this.leads = []; this.handoffs = [];
    this.messages = []; this.auditEvents = []; this.automationRuns = [];
    this.conversations = []; this.products = []; this.templates = [];
    this.orders = []; this.packages = []; this.bookings = [];
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
