import { describe, it, expect } from 'vitest';
import { randomUUID } from 'crypto';
import {
  OrganizationSchema,
  ContactSchema,
  LeadSchema,
  ConversationSchema,
  HandoffSchema,
  ConsentRecordSchema,
  AuditEventSchema,
  MemberRole,
  IntentType,
  LeadStage,
  CampaignType,
} from '../schemas';

const now = new Date();
const orgId = randomUUID();
const contactId = randomUUID();
const conversationId = randomUUID();

describe('OrganizationSchema', () => {
  it('validates a valid organization', () => {
    const result = OrganizationSchema.safeParse({
      id: orgId,
      name: 'GlowRoot Skincare',
      slug: 'glowroot-skincare',
      vertical: 'd2c-skincare',
      created_at: now,
      updated_at: now,
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing name', () => {
    const result = OrganizationSchema.safeParse({
      id: orgId,
      slug: 'test',
      created_at: now,
      updated_at: now,
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty name', () => {
    const result = OrganizationSchema.safeParse({
      id: orgId,
      name: '',
      slug: 'test',
      created_at: now,
      updated_at: now,
    });
    expect(result.success).toBe(false);
  });
});

describe('ContactSchema', () => {
  it('validates a valid contact', () => {
    const result = ContactSchema.safeParse({
      id: contactId,
      organization_id: orgId,
      phone_number: '+919876543210',
      name: 'Priya Sharma',
      created_at: now,
      updated_at: now,
    });
    expect(result.success).toBe(true);
  });

  it('rejects phone number shorter than 7 chars', () => {
    const result = ContactSchema.safeParse({
      id: contactId,
      organization_id: orgId,
      phone_number: '123',
      created_at: now,
      updated_at: now,
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing organization_id', () => {
    const result = ContactSchema.safeParse({
      id: contactId,
      phone_number: '+919876543210',
      created_at: now,
      updated_at: now,
    });
    expect(result.success).toBe(false);
  });
});

describe('LeadSchema', () => {
  it('validates a valid lead', () => {
    const result = LeadSchema.safeParse({
      id: randomUUID(),
      organization_id: orgId,
      contact_id: contactId,
      conversation_id: conversationId,
      stage: 'qualified',
      service_interest: 'sunscreen for oily skin',
      score: 75,
      idempotency_key: 'lead:test:001',
      created_at: now,
      updated_at: now,
    });
    expect(result.success).toBe(true);
  });

  it('rejects score above 100', () => {
    const result = LeadSchema.safeParse({
      id: randomUUID(),
      organization_id: orgId,
      contact_id: contactId,
      stage: 'new',
      service_interest: 'test',
      score: 150,
      idempotency_key: 'test',
      created_at: now,
      updated_at: now,
    });
    expect(result.success).toBe(false);
  });

  it('rejects score below 0', () => {
    const result = LeadSchema.safeParse({
      id: randomUUID(),
      organization_id: orgId,
      contact_id: contactId,
      stage: 'new',
      service_interest: 'test',
      score: -1,
      idempotency_key: 'test',
      created_at: now,
      updated_at: now,
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid lead stage', () => {
    const result = LeadSchema.safeParse({
      id: randomUUID(),
      organization_id: orgId,
      contact_id: contactId,
      stage: 'invalid_stage',
      service_interest: 'test',
      idempotency_key: 'test',
      created_at: now,
      updated_at: now,
    });
    expect(result.success).toBe(false);
  });
});

describe('ConversationSchema', () => {
  it('validates a valid conversation', () => {
    const result = ConversationSchema.safeParse({
      id: conversationId,
      organization_id: orgId,
      contact_id: contactId,
      status: 'active',
      created_at: now,
      updated_at: now,
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid status', () => {
    const result = ConversationSchema.safeParse({
      id: conversationId,
      organization_id: orgId,
      contact_id: contactId,
      status: 'invalid',
      created_at: now,
      updated_at: now,
    });
    expect(result.success).toBe(false);
  });
});

describe('HandoffSchema', () => {
  it('validates a valid handoff', () => {
    const result = HandoffSchema.safeParse({
      id: randomUUID(),
      organization_id: orgId,
      conversation_id: conversationId,
      contact_id: contactId,
      reason: 'complaint_or_refund',
      priority: 'high',
      status: 'pending',
      summary: 'Customer requests refund for damaged product.',
      created_at: now,
      updated_at: now,
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid reason', () => {
    const result = HandoffSchema.safeParse({
      id: randomUUID(),
      organization_id: orgId,
      conversation_id: conversationId,
      contact_id: contactId,
      reason: 'random_reason',
      priority: 'high',
      status: 'pending',
      summary: 'test',
      created_at: now,
      updated_at: now,
    });
    expect(result.success).toBe(false);
  });
});

describe('AuditEventSchema', () => {
  it('validates a valid audit event', () => {
    const result = AuditEventSchema.safeParse({
      id: randomUUID(),
      organization_id: orgId,
      action: 'lead_created',
      entity_type: 'lead',
      entity_id: randomUUID(),
      actor_type: 'agent',
      trace_id: 'trace-123',
      created_at: now,
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid actor_type', () => {
    const result = AuditEventSchema.safeParse({
      id: randomUUID(),
      organization_id: orgId,
      action: 'lead_created',
      entity_type: 'lead',
      actor_type: 'invalid',
      created_at: now,
    });
    expect(result.success).toBe(false);
  });
});

describe('ConsentRecordSchema', () => {
  it('validates a valid consent record', () => {
    const result = ConsentRecordSchema.safeParse({
      id: randomUUID(),
      organization_id: orgId,
      contact_id: contactId,
      consent_type: 'marketing',
      action: 'opt_in',
      source: 'whatsapp_first_message',
      recorded_at: now,
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid consent action', () => {
    const result = ConsentRecordSchema.safeParse({
      id: randomUUID(),
      organization_id: orgId,
      contact_id: contactId,
      consent_type: 'marketing',
      action: 'maybe',
      source: 'test',
      recorded_at: now,
    });
    expect(result.success).toBe(false);
  });
});

describe('Enums', () => {
  it('MemberRole accepts valid roles', () => {
    expect(MemberRole.safeParse('owner').success).toBe(true);
    expect(MemberRole.safeParse('manager').success).toBe(true);
    expect(MemberRole.safeParse('sales_agent').success).toBe(true);
    expect(MemberRole.safeParse('support_agent').success).toBe(true);
  });

  it('MemberRole rejects invalid role', () => {
    expect(MemberRole.safeParse('admin').success).toBe(false);
  });

  it('IntentType accepts all valid intents', () => {
    const intents = [
      'sales_enquiry', 'product_question', 'support_question',
      'order_status', 'booking_request', 'complaint_or_refund',
      'human_request', 'opt_out', 'unsafe_request', 'unknown',
    ];
    for (const intent of intents) {
      expect(IntentType.safeParse(intent).success).toBe(true);
    }
  });

  it('LeadStage accepts all valid stages', () => {
    const stages = [
      'new', 'contacted', 'qualified', 'proposal',
      'negotiation', 'won', 'lost', 'disqualified',
    ];
    for (const stage of stages) {
      expect(LeadStage.safeParse(stage).success).toBe(true);
    }
  });

  it('CampaignType accepts all valid types', () => {
    const types = [
      'qualified_lead_followup', 'appointment_reminder',
      'reorder_reminder', 'abandoned_enquiry',
    ];
    for (const type of types) {
      expect(CampaignType.safeParse(type).success).toBe(true);
    }
  });
});
