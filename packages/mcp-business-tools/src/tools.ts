import { randomUUID } from 'crypto';
import { logger, TenantAccessError, ConsentRequiredError } from '@business-os-ai/shared-types';
import { assertTenantMatch } from '@business-os-ai/database';
import type {
  GetCustomerContextInput, GetCustomerContextOutput,
  UpsertQualifiedLeadInput, CreateHumanHandoffInput,
  SearchProductCatalogInput, RequestFollowupScheduleInput,
  GetOrderStatusInput, GetOrderStatusOutput,
} from './schemas';

// ─── In-memory store for MVP ────────────────────────────────────────

interface Contact { id: string; organizationId: string; phone: string; name?: string; }
interface ConsentRecord { contactId: string; organizationId: string; consentType: string; action: string; }
interface Lead { id: string; organizationId: string; contactId: string; conversationId: string; stage: string; serviceInterest: string; budgetRange?: string; purchaseTimeline?: string; qualificationSummary?: string; score?: number; idempotencyKey: string; }
interface Handoff { id: string; organizationId: string; conversationId: string; contactId: string; reason: string; priority: string; status: string; summary: string; idempotencyKey: string; }
interface Message { direction: string; content: string; createdAt: string; organizationId: string; conversationId: string; }
interface AuditEvent { id: string; organizationId: string; action: string; entityType: string; entityId: string; actorType: string; details: Record<string, unknown>; createdAt: string; }
interface AutomationRun { id: string; organizationId: string; contactId: string; conversationId: string; templateKey: string; campaignType: string; idempotencyKey: string; status: string; scheduledFor: string; }
interface ConversationState { id: string; organizationId: string; status: string; }
interface Product { sku: string; name: string; price: string; skinType: string; description: string; suitableFor: string; organizationId: string; }
interface Template { templateKey: string; organizationId: string; status: string; }
export interface Order { id: string; organizationId: string; contactId: string; orderNumber: string; status: string; totalAmount: string; items: string; estimatedDelivery: string; }

export class ToolDataStore {
  contacts: Contact[] = [];
  consentRecords: ConsentRecord[] = [];
  leads: Lead[] = [];
  handoffs: Handoff[] = [];
  messages: Message[] = [];
  auditEvents: AuditEvent[] = [];
  automationRuns: AutomationRun[] = [];
  conversations: ConversationState[] = [];
  products: Product[] = [];
  templates: Template[] = [];
  orders: Order[] = [];

  clear(): void {
    this.contacts = []; this.consentRecords = []; this.leads = []; this.handoffs = [];
    this.messages = []; this.auditEvents = []; this.automationRuns = [];
    this.conversations = []; this.products = []; this.templates = [];
    this.orders = [];
  }
}

// ─── Tool implementations ───────────────────────────────────────────

export function getCustomerContext(store: ToolDataStore, input: GetCustomerContextInput): GetCustomerContextOutput {
  const contact = store.contacts.find((c) => c.id === input.contactId && c.organizationId === input.organizationId);
  if (!contact) {
    throw new TenantAccessError('Contact not found in organization.');
  }
  assertTenantMatch(contact.organizationId, input.organizationId);

  const marketingConsent = store.consentRecords.filter((c) => c.contactId === input.contactId && c.organizationId === input.organizationId && c.consentType === 'marketing');
  const transactionalConsent = store.consentRecords.filter((c) => c.contactId === input.contactId && c.organizationId === input.organizationId && c.consentType === 'transactional');
  const latestMarketing = marketingConsent[marketingConsent.length - 1];
  const latestTransactional = transactionalConsent[transactionalConsent.length - 1];

  const latestLead = store.leads.filter((l) => l.contactId === input.contactId && l.organizationId === input.organizationId).pop();
  const recentMessages = store.messages
    .filter((m) => m.conversationId === input.conversationId && m.organizationId === input.organizationId)
    .slice(-10)
    .map((m) => ({ direction: m.direction as 'inbound' | 'outbound', content: m.content, createdAt: m.createdAt }));

  const openHandoff = store.handoffs.find((h) => h.conversationId === input.conversationId && h.organizationId === input.organizationId && (h.status === 'pending' || h.status === 'claimed'));

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

export function upsertQualifiedLead(store: ToolDataStore, input: UpsertQualifiedLeadInput): { leadId: string; action: 'created' | 'updated'; stage: string } {
  // Validate tenant relationship
  const contact = store.contacts.find((c) => c.id === input.contactId && c.organizationId === input.organizationId);
  if (!contact) throw new TenantAccessError('Contact not found in organization.');

  const conversation = store.conversations.find((c) => c.id === input.conversationId && c.organizationId === input.organizationId);
  if (!conversation) throw new TenantAccessError('Conversation not found in organization.');

  // Idempotency check
  const existing = store.leads.find((l) => l.organizationId === input.organizationId && l.idempotencyKey === input.idempotencyKey);
  if (existing) {
    // Update existing
    existing.serviceInterest = input.serviceInterest;
    existing.budgetRange = input.budgetRange;
    existing.purchaseTimeline = input.purchaseTimeline;
    existing.qualificationSummary = input.qualificationSummary;
    existing.score = input.score;
    existing.stage = input.score >= 50 ? 'qualified' : 'contacted';

    store.auditEvents.push({ id: randomUUID(), organizationId: input.organizationId, action: 'lead_updated', entityType: 'lead', entityId: existing.id, actorType: 'agent', details: { idempotencyKey: input.idempotencyKey }, createdAt: new Date().toISOString() });

    return { leadId: existing.id, action: 'updated', stage: existing.stage };
  }

  const leadId = randomUUID();
  const stage = input.score >= 50 ? 'qualified' : 'contacted';
  store.leads.push({
    id: leadId, organizationId: input.organizationId, contactId: input.contactId, conversationId: input.conversationId,
    stage, serviceInterest: input.serviceInterest, budgetRange: input.budgetRange,
    purchaseTimeline: input.purchaseTimeline, qualificationSummary: input.qualificationSummary,
    score: input.score, idempotencyKey: input.idempotencyKey,
  });

  store.auditEvents.push({ id: randomUUID(), organizationId: input.organizationId, action: 'lead_created', entityType: 'lead', entityId: leadId, actorType: 'agent', details: { idempotencyKey: input.idempotencyKey, score: input.score }, createdAt: new Date().toISOString() });

  logger.info('Lead created', { organizationId: input.organizationId, leadId });
  return { leadId, action: 'created', stage };
}

export function createHumanHandoff(store: ToolDataStore, input: CreateHumanHandoffInput): { handoffId: string; conversationStatus: string } {
  const contact = store.contacts.find((c) => c.id === input.contactId && c.organizationId === input.organizationId);
  if (!contact) throw new TenantAccessError('Contact not found in organization.');

  const conversation = store.conversations.find((c) => c.id === input.conversationId && c.organizationId === input.organizationId);
  if (!conversation) throw new TenantAccessError('Conversation not found in organization.');

  // Idempotency
  const existing = store.handoffs.find((h) => h.organizationId === input.organizationId && h.idempotencyKey === input.idempotencyKey);
  if (existing) {
    return { handoffId: existing.id, conversationStatus: 'waiting_for_human' };
  }

  const handoffId = randomUUID();
  store.handoffs.push({
    id: handoffId, organizationId: input.organizationId, conversationId: input.conversationId,
    contactId: input.contactId, reason: input.reason, priority: input.priority,
    status: 'pending', summary: input.summary, idempotencyKey: input.idempotencyKey,
  });

  // Update conversation status
  conversation.status = 'waiting_for_human';

  store.auditEvents.push({ id: randomUUID(), organizationId: input.organizationId, action: 'handoff_created', entityType: 'handoff', entityId: handoffId, actorType: 'agent', details: { reason: input.reason, priority: input.priority }, createdAt: new Date().toISOString() });

  logger.info('Human handoff created', { organizationId: input.organizationId, handoffId });
  return { handoffId, conversationStatus: 'waiting_for_human' };
}

export function searchProductCatalog(store: ToolDataStore, input: SearchProductCatalogInput): { products: Array<{ sku: string; name: string; price: string; skinType: string; description: string; suitableFor: string }> } {
  const orgProducts = store.products.filter((p) => p.organizationId === input.organizationId);
  const query = input.query.toLowerCase();

  const matched = orgProducts.filter((p) => {
    const text = `${p.name} ${p.description} ${p.skinType} ${p.suitableFor}`.toLowerCase();
    if (!text.includes(query) && !query.split(' ').some((w) => text.includes(w))) return false;
    if (input.skinType && !p.skinType.toLowerCase().includes(input.skinType.toLowerCase())) return false;
    if (input.concern && !p.description.toLowerCase().includes(input.concern.toLowerCase())) return false;
    return true;
  });

  return {
    products: matched.map((p) => ({
      sku: p.sku, name: p.name, price: p.price,
      skinType: p.skinType, description: p.description, suitableFor: p.suitableFor,
    })),
  };
}

export function requestFollowupSchedule(store: ToolDataStore, input: RequestFollowupScheduleInput): { automationRunId: string; status: string; scheduledFor: string } {
  const contact = store.contacts.find((c) => c.id === input.contactId && c.organizationId === input.organizationId);
  if (!contact) throw new TenantAccessError('Contact not found in organization.');

  // Check consent — recorded opt-in required
  const marketingConsent = store.consentRecords.filter((c) => c.contactId === input.contactId && c.organizationId === input.organizationId && c.consentType === 'marketing');
  const latest = marketingConsent[marketingConsent.length - 1];
  if (!latest || latest.action !== 'opt_in') {
    throw new ConsentRequiredError('Marketing opt-in required for follow-up scheduling.');
  }

  // Check for opt-out
  const optOuts = store.consentRecords.filter((c) => c.contactId === input.contactId && c.organizationId === input.organizationId && c.action === 'opt_out');
  if (optOuts.length > 0) {
    const lastOptOut = optOuts[optOuts.length - 1]!;
    const lastOptIn = marketingConsent.filter((c) => c.action === 'opt_in').pop();
    // If opt-out is more recent than opt-in, deny
    if (!lastOptIn || optOuts.indexOf(lastOptOut) > marketingConsent.indexOf(lastOptIn)) {
      throw new ConsentRequiredError('Contact has opted out of marketing messages.');
    }
  }

  // Check template exists and is approved
  const template = store.templates.find((t) => t.templateKey === input.templateKey && t.organizationId === input.organizationId);
  if (!template || template.status !== 'approved') {
    throw new TenantAccessError('Template not found or not approved for this organization.');
  }

  // Idempotency
  const existing = store.automationRuns.find((r) => r.organizationId === input.organizationId && r.idempotencyKey === input.idempotencyKey);
  if (existing) {
    return { automationRunId: existing.id, status: existing.status, scheduledFor: existing.scheduledFor };
  }

  // Check sending window (9-21 UTC)
  const scheduledHour = input.scheduledFor.getUTCHours();
  if (scheduledHour < 9 || scheduledHour >= 21) {
    throw new ConsentRequiredError('Scheduled time is outside the allowed sending window (09:00-21:00).');
  }

  const runId = randomUUID();
  store.automationRuns.push({
    id: runId, organizationId: input.organizationId, contactId: input.contactId,
    conversationId: input.conversationId, templateKey: input.templateKey,
    campaignType: input.campaignType, idempotencyKey: input.idempotencyKey,
    status: 'scheduled', scheduledFor: input.scheduledFor.toISOString(),
  });

  store.auditEvents.push({ id: randomUUID(), organizationId: input.organizationId, action: 'automation_scheduled', entityType: 'automation_run', entityId: runId, actorType: 'agent', details: { templateKey: input.templateKey, campaignType: input.campaignType }, createdAt: new Date().toISOString() });

  return { automationRunId: runId, status: 'scheduled', scheduledFor: input.scheduledFor.toISOString() };
}

export function getOrderStatus(store: ToolDataStore, input: GetOrderStatusInput): GetOrderStatusOutput {
  const contact = store.contacts.find((c) => c.id === input.contactId && c.organizationId === input.organizationId);
  if (!contact) {
    throw new TenantAccessError('Contact not found in organization.');
  }

  const order = store.orders.find(
    (o) => o.orderNumber.toLowerCase() === input.orderNumber.toLowerCase() &&
           o.contactId === input.contactId &&
           o.organizationId === input.organizationId
  );

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
