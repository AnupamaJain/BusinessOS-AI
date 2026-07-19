import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'crypto';
import { ToolDataStore, getCustomerContext, upsertQualifiedLead, createHumanHandoff, searchProductCatalog, requestFollowupSchedule, getOrderStatus, searchTravelPackages, createTravelBooking } from '../tools';
import { GetCustomerContextInput, UpsertQualifiedLeadInput, CreateHumanHandoffInput, GetOrderStatusInput } from '../schemas';

const ORG_A = '11111111-1111-1111-1111-111111111111';
const ORG_B = '22222222-2222-2222-2222-222222222222';
const CONTACT_A = randomUUID();
const CONV_A = randomUUID();

function seedStore(store: ToolDataStore) {
  store.contacts.push({ id: CONTACT_A, organizationId: ORG_A, phone: '+919876543210', name: 'Priya' });
  store.conversations.push({ id: CONV_A, organizationId: ORG_A, status: 'active' });
  store.consentRecords.push({ contactId: CONTACT_A, organizationId: ORG_A, consentType: 'marketing', action: 'opt_in' });
  store.consentRecords.push({ contactId: CONTACT_A, organizationId: ORG_A, consentType: 'transactional', action: 'opt_in' });
  store.messages.push({ direction: 'inbound', content: 'I need sunscreen', createdAt: new Date().toISOString(), organizationId: ORG_A, conversationId: CONV_A });
  store.products.push(
    { sku: 'GR-SUN-001', name: 'AquaShield SPF 50', price: '₹799', skinType: 'Oily, combination', description: 'Matte sunscreen for oily skin', suitableFor: 'Daily use', organizationId: ORG_A },
    { sku: 'GR-SUN-002', name: 'HydraGlow SPF 40', price: '₹899', skinType: 'Dry, normal', description: 'Hydrating sunscreen', suitableFor: 'Daily use', organizationId: ORG_A },
  );
  store.templates.push({ templateKey: 'qualified_lead_24h_followup', organizationId: ORG_A, status: 'approved' });
  store.orders.push({ id: 'order-1', organizationId: ORG_A, contactId: CONTACT_A, orderNumber: 'GR-12345', status: 'Shipped', totalAmount: '₹799', items: 'AquaShield SPF 50', estimatedDelivery: '2026-07-22' });
}

describe('getCustomerContext', () => {
  let store: ToolDataStore;
  beforeEach(() => { store = new ToolDataStore(); seedStore(store); });

  it('returns full customer context', async () => {
    const result = await getCustomerContext(store, { organizationId: ORG_A, contactId: CONTACT_A, conversationId: CONV_A, requestedFields: ['profile', 'consent', 'lead', 'messages', 'handoff'] });
    expect(result.contact.name).toBe('Priya');
    expect(result.consentStatus.marketing).toBe('opted_in');
    expect(result.recentMessages.length).toBe(1);
  });

  it('throws for cross-tenant access', async () => {
    await expect(getCustomerContext(store, { organizationId: ORG_B, contactId: CONTACT_A, conversationId: CONV_A, requestedFields: [] })).rejects.toThrow('Contact not found');
  });
});

describe('upsertQualifiedLead', () => {
  let store: ToolDataStore;
  beforeEach(() => { store = new ToolDataStore(); seedStore(store); });

  it('creates a new lead', async () => {
    const result = await upsertQualifiedLead(store, { organizationId: ORG_A, contactId: CONTACT_A, conversationId: CONV_A, serviceInterest: 'sunscreen', qualificationSummary: 'Interested in oily skin products', score: 75, idempotencyKey: 'lead-001' });
    expect(result.action).toBe('created');
    expect(result.stage).toBe('qualified');
    expect(store.auditEvents.length).toBe(1);
  });

  it('updates on duplicate idempotency key', async () => {
    await upsertQualifiedLead(store, { organizationId: ORG_A, contactId: CONTACT_A, conversationId: CONV_A, serviceInterest: 'sunscreen', qualificationSummary: 'v1', score: 60, idempotencyKey: 'lead-dup' });
    const result = await upsertQualifiedLead(store, { organizationId: ORG_A, contactId: CONTACT_A, conversationId: CONV_A, serviceInterest: 'serum', qualificationSummary: 'v2', score: 80, idempotencyKey: 'lead-dup' });
    expect(result.action).toBe('updated');
    expect(store.leads.length).toBe(1);
  });

  it('sets stage to contacted for low score', async () => {
    const result = await upsertQualifiedLead(store, { organizationId: ORG_A, contactId: CONTACT_A, conversationId: CONV_A, serviceInterest: 'test', qualificationSummary: 'low', score: 30, idempotencyKey: 'low-score' });
    expect(result.stage).toBe('contacted');
  });

  it('rejects cross-tenant contact', async () => {
    await expect(upsertQualifiedLead(store, { organizationId: ORG_B, contactId: CONTACT_A, conversationId: CONV_A, serviceInterest: 'x', qualificationSummary: 'x', score: 50, idempotencyKey: 'x' })).rejects.toThrow();
  });
});

describe('createHumanHandoff', () => {
  let store: ToolDataStore;
  beforeEach(() => { store = new ToolDataStore(); seedStore(store); });

  it('creates handoff and sets conversation to waiting_for_human', async () => {
    const result = await createHumanHandoff(store, { organizationId: ORG_A, contactId: CONTACT_A, conversationId: CONV_A, reason: 'complaint_or_refund', priority: 'high', summary: 'Customer wants refund', idempotencyKey: 'handoff-001' });
    expect(result.conversationStatus).toBe('waiting_for_human');
    const conv = store.conversations.find((c) => c.id === CONV_A);
    expect(conv?.status).toBe('waiting_for_human');
  });

  it('returns existing handoff on duplicate key', async () => {
    const r1 = await createHumanHandoff(store, { organizationId: ORG_A, contactId: CONTACT_A, conversationId: CONV_A, reason: 'customer_request', priority: 'medium', summary: 'Test', idempotencyKey: 'handoff-dup' });
    const r2 = await createHumanHandoff(store, { organizationId: ORG_A, contactId: CONTACT_A, conversationId: CONV_A, reason: 'customer_request', priority: 'medium', summary: 'Test', idempotencyKey: 'handoff-dup' });
    expect(r1.handoffId).toBe(r2.handoffId);
    expect(store.handoffs.length).toBe(1);
  });
});

describe('searchProductCatalog', () => {
  let store: ToolDataStore;
  beforeEach(() => { store = new ToolDataStore(); seedStore(store); });

  it('finds products by query', async () => {
    const result = await searchProductCatalog(store, { organizationId: ORG_A, query: 'sunscreen' });
    expect(result.products.length).toBe(2);
  });

  it('filters by skin type', async () => {
    const result = await searchProductCatalog(store, { organizationId: ORG_A, query: 'sunscreen', skinType: 'oily' });
    expect(result.products.length).toBe(1);
    expect(result.products[0]?.sku).toBe('GR-SUN-001');
  });

  it('returns empty for other org', async () => {
    const result = await searchProductCatalog(store, { organizationId: ORG_B, query: 'sunscreen' });
    expect(result.products.length).toBe(0);
  });
});

describe('requestFollowupSchedule', () => {
  let store: ToolDataStore;
  beforeEach(() => { store = new ToolDataStore(); seedStore(store); });

  it('creates scheduled follow-up with consent', async () => {
    const scheduledFor = new Date();
    scheduledFor.setUTCHours(14);
    const result = await requestFollowupSchedule(store, { organizationId: ORG_A, contactId: CONTACT_A, conversationId: CONV_A, templateKey: 'qualified_lead_24h_followup', scheduledFor, campaignType: 'qualified_lead_followup', idempotencyKey: 'followup-001' });
    expect(result.status).toBe('scheduled');
  });

  it('rejects without consent', async () => {
    store.consentRecords = [];
    const scheduledFor = new Date();
    scheduledFor.setUTCHours(14);
    await expect(requestFollowupSchedule(store, { organizationId: ORG_A, contactId: CONTACT_A, conversationId: CONV_A, templateKey: 'qualified_lead_24h_followup', scheduledFor, campaignType: 'qualified_lead_followup', idempotencyKey: 'no-consent' })).rejects.toThrow('opt-in required');
  });

  it('rejects unapproved template', async () => {
    store.templates = [{ templateKey: 'unapproved', organizationId: ORG_A, status: 'pending' }];
    const scheduledFor = new Date();
    scheduledFor.setUTCHours(14);
    await expect(requestFollowupSchedule(store, { organizationId: ORG_A, contactId: CONTACT_A, conversationId: CONV_A, templateKey: 'unapproved', scheduledFor, campaignType: 'qualified_lead_followup', idempotencyKey: 'bad-template' })).rejects.toThrow('not approved');
  });

  it('prevents duplicate follow-ups', async () => {
    const scheduledFor = new Date();
    scheduledFor.setUTCHours(14);
    await requestFollowupSchedule(store, { organizationId: ORG_A, contactId: CONTACT_A, conversationId: CONV_A, templateKey: 'qualified_lead_24h_followup', scheduledFor, campaignType: 'qualified_lead_followup', idempotencyKey: 'followup-dup' });
    const r2 = await requestFollowupSchedule(store, { organizationId: ORG_A, contactId: CONTACT_A, conversationId: CONV_A, templateKey: 'qualified_lead_24h_followup', scheduledFor, campaignType: 'qualified_lead_followup', idempotencyKey: 'followup-dup' });
    expect(store.automationRuns.length).toBe(1);
    expect(r2.status).toBe('scheduled');
  });

  it('rejects outside sending window', async () => {
    const scheduledFor = new Date();
    scheduledFor.setUTCHours(3); // 3 AM
    await expect(requestFollowupSchedule(store, { organizationId: ORG_A, contactId: CONTACT_A, conversationId: CONV_A, templateKey: 'qualified_lead_24h_followup', scheduledFor, campaignType: 'qualified_lead_followup', idempotencyKey: 'late-night' })).rejects.toThrow('sending window');
  });
});

describe('getOrderStatus', () => {
  let store: ToolDataStore;
  beforeEach(() => { store = new ToolDataStore(); seedStore(store); });

  it('retrieves an existing order status successfully', async () => {
    const result = await getOrderStatus(store, { organizationId: ORG_A, contactId: CONTACT_A, orderNumber: 'GR-12345' });
    expect(result.found).toBe(true);
    expect(result.order?.status).toBe('Shipped');
    expect(result.order?.items).toBe('AquaShield SPF 50');
  });

  it('returns found false for non-existent order number', async () => {
    const result = await getOrderStatus(store, { organizationId: ORG_A, contactId: CONTACT_A, orderNumber: 'GR-99999' });
    expect(result.found).toBe(false);
  });

  it('prevents cross-tenant exfiltration of order details', async () => {
    await expect(getOrderStatus(store, { organizationId: ORG_B, contactId: CONTACT_A, orderNumber: 'GR-12345' })).rejects.toThrow();
  });
});

describe('MCP Tool Schema Validation', () => {
  it('validates GetCustomerContextInput', async () => {
    const result = GetCustomerContextInput.safeParse({ organizationId: ORG_A, contactId: CONTACT_A, conversationId: CONV_A });
    expect(result.success).toBe(true);
  });

  it('rejects invalid UpsertQualifiedLeadInput', async () => {
    const result = UpsertQualifiedLeadInput.safeParse({ organizationId: 'not-uuid', contactId: CONTACT_A, conversationId: CONV_A, serviceInterest: '', qualificationSummary: '', score: 200, idempotencyKey: '' });
    expect(result.success).toBe(false);
  });
});

describe('Travel MCP Tools', () => {
  let store: ToolDataStore;
  beforeEach(() => { store = new ToolDataStore(); seedStore(store); });

  it('searches holiday packages by destination filter', async () => {
    const resAll = await searchTravelPackages(store, { organizationId: ORG_A });
    expect(resAll.packages.length).toBe(3);

    const resBali = await searchTravelPackages(store, { organizationId: ORG_A, destination: 'Bali' });
    expect(resBali.packages.length).toBe(1);
    expect(resBali.packages[0]?.sku).toBe('TRV-BALI-001');
  });

  it('creates travel booking and logs audit event', async () => {
    const res = await createTravelBooking(store, {
      organizationId: ORG_A,
      contactId: CONTACT_A,
      packageSku: 'TRV-BALI-001',
      travelDate: '2026-10-15',
      travelerCount: 2,
      idempotencyKey: 'bk-test-01'
    });

    expect(res.bookingNumber).toContain('BK-');
    expect(res.status).toBe('confirmed');

    const audit = store.auditEvents.find(e => e.action === 'travel_booking_created');
    expect(audit).toBeDefined();
  });

  it('validates CreateHumanHandoffInput', async () => {
    const result = CreateHumanHandoffInput.safeParse({ organizationId: ORG_A, contactId: CONTACT_A, conversationId: CONV_A, reason: 'complaint_or_refund', priority: 'high', summary: 'test', idempotencyKey: 'key' });
    expect(result.success).toBe(true);
  });

  it('rejects invalid reason enum', async () => {
    const result = CreateHumanHandoffInput.safeParse({ organizationId: ORG_A, contactId: CONTACT_A, conversationId: CONV_A, reason: 'invalid_reason', priority: 'high', summary: 'test', idempotencyKey: 'key' });
    expect(result.success).toBe(false);
  });

  it('validates GetOrderStatusInput', async () => {
    const result = GetOrderStatusInput.safeParse({ organizationId: ORG_A, contactId: CONTACT_A, orderNumber: 'GR-123' });
    expect(result.success).toBe(true);
  });
});
