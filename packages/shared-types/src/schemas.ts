import { z } from 'zod';

// ─── Common primitives ─────────────────────────────────────────────

export const uuidSchema = z.string().uuid();
export const timestampSchema = z.coerce.date();
export const phoneSchema = z.string().min(7).max(20);

// ─── Enums ──────────────────────────────────────────────────────────

export const MemberRole = z.enum([
  'owner',
  'manager',
  'sales_agent',
  'support_agent',
]);
export type MemberRole = z.infer<typeof MemberRole>;

export const ConsentType = z.enum([
  'marketing',
  'transactional',
  'support',
]);
export type ConsentType = z.infer<typeof ConsentType>;

export const ConsentAction = z.enum(['opt_in', 'opt_out']);
export type ConsentAction = z.infer<typeof ConsentAction>;

export const LeadStage = z.enum([
  'new',
  'contacted',
  'qualified',
  'proposal',
  'negotiation',
  'won',
  'lost',
  'disqualified',
]);
export type LeadStage = z.infer<typeof LeadStage>;

export const ConversationStatus = z.enum([
  'active',
  'waiting_for_human',
  'resolved',
  'closed',
]);
export type ConversationStatus = z.infer<typeof ConversationStatus>;

export const MessageDirection = z.enum(['inbound', 'outbound']);
export type MessageDirection = z.infer<typeof MessageDirection>;

export const MessageType = z.enum([
  'text',
  'image',
  'document',
  'template',
  'interactive',
  'reaction',
  'system',
]);
export type MessageType = z.infer<typeof MessageType>;

export const HandoffReason = z.enum([
  'customer_request',
  'complaint_or_refund',
  'payment_issue',
  'legal_or_medical',
  'low_confidence',
  'repeated_failure',
  'integration_error',
  'unsafe_request',
]);
export type HandoffReason = z.infer<typeof HandoffReason>;

export const HandoffPriority = z.enum(['low', 'medium', 'high', 'urgent']);
export type HandoffPriority = z.infer<typeof HandoffPriority>;

export const HandoffStatus = z.enum([
  'pending',
  'claimed',
  'resolved',
  'expired',
]);
export type HandoffStatus = z.infer<typeof HandoffStatus>;

export const AutomationStatus = z.enum([
  'scheduled',
  'eligible',
  'sent',
  'skipped',
  'failed',
  'cancelled',
]);
export type AutomationStatus = z.infer<typeof AutomationStatus>;

export const AuditAction = z.enum([
  'lead_created',
  'lead_updated',
  'lead_qualified',
  'handoff_created',
  'handoff_claimed',
  'handoff_resolved',
  'message_sent',
  'message_received',
  'consent_recorded',
  'automation_scheduled',
  'automation_sent',
  'automation_skipped',
  'tool_invoked',
  'policy_violation',
  'opt_out_recorded',
  'template_send_created',
]);
export type AuditAction = z.infer<typeof AuditAction>;

export const IntentType = z.enum([
  'sales_enquiry',
  'product_question',
  'support_question',
  'order_status',
  'booking_request',
  'complaint_or_refund',
  'human_request',
  'opt_out',
  'unsafe_request',
  'unknown',
]);
export type IntentType = z.infer<typeof IntentType>;

export const CampaignType = z.enum([
  'qualified_lead_followup',
  'appointment_reminder',
  'reorder_reminder',
  'abandoned_enquiry',
]);
export type CampaignType = z.infer<typeof CampaignType>;

// ─── Entity schemas ─────────────────────────────────────────────────

export const OrganizationSchema = z.object({
  id: uuidSchema,
  name: z.string().min(1).max(255),
  slug: z.string().min(1).max(100),
  vertical: z.string().max(100).optional(),
  settings: z.record(z.unknown()).optional(),
  created_at: timestampSchema,
  updated_at: timestampSchema,
});
export type Organization = z.infer<typeof OrganizationSchema>;

export const OrganizationMemberSchema = z.object({
  id: uuidSchema,
  organization_id: uuidSchema,
  user_id: uuidSchema,
  role: MemberRole,
  created_at: timestampSchema,
});
export type OrganizationMember = z.infer<typeof OrganizationMemberSchema>;

export const ContactSchema = z.object({
  id: uuidSchema,
  organization_id: uuidSchema,
  phone_number: phoneSchema,
  name: z.string().max(255).optional(),
  email: z.string().email().optional(),
  metadata: z.record(z.unknown()).optional(),
  created_at: timestampSchema,
  updated_at: timestampSchema,
});
export type Contact = z.infer<typeof ContactSchema>;

export const ConsentRecordSchema = z.object({
  id: uuidSchema,
  organization_id: uuidSchema,
  contact_id: uuidSchema,
  consent_type: ConsentType,
  action: ConsentAction,
  source: z.string().max(255),
  recorded_at: timestampSchema,
});
export type ConsentRecord = z.infer<typeof ConsentRecordSchema>;

export const LeadSchema = z.object({
  id: uuidSchema,
  organization_id: uuidSchema,
  contact_id: uuidSchema,
  conversation_id: uuidSchema.optional(),
  stage: LeadStage,
  service_interest: z.string().max(500),
  budget_range: z.string().max(100).optional(),
  purchase_timeline: z.string().max(100).optional(),
  qualification_summary: z.string().max(2000).optional(),
  score: z.number().int().min(0).max(100).optional(),
  owner_id: uuidSchema.optional(),
  idempotency_key: z.string().max(255),
  created_at: timestampSchema,
  updated_at: timestampSchema,
});
export type Lead = z.infer<typeof LeadSchema>;

export const ConversationSchema = z.object({
  id: uuidSchema,
  organization_id: uuidSchema,
  contact_id: uuidSchema,
  channel: z.string().max(50).default('whatsapp'),
  status: ConversationStatus,
  metadata: z.record(z.unknown()).optional(),
  created_at: timestampSchema,
  updated_at: timestampSchema,
});
export type Conversation = z.infer<typeof ConversationSchema>;

export const MessageSchema = z.object({
  id: uuidSchema,
  organization_id: uuidSchema,
  conversation_id: uuidSchema,
  direction: MessageDirection,
  message_type: MessageType,
  content: z.string(),
  provider_message_id: z.string().max(255).optional(),
  metadata: z.record(z.unknown()).optional(),
  created_at: timestampSchema,
});
export type Message = z.infer<typeof MessageSchema>;

export const HandoffSchema = z.object({
  id: uuidSchema,
  organization_id: uuidSchema,
  conversation_id: uuidSchema,
  contact_id: uuidSchema,
  reason: HandoffReason,
  priority: HandoffPriority,
  status: HandoffStatus,
  summary: z.string().max(2000),
  claimed_by: uuidSchema.optional(),
  resolved_at: timestampSchema.optional(),
  created_at: timestampSchema,
  updated_at: timestampSchema,
});
export type Handoff = z.infer<typeof HandoffSchema>;

export const LeadActivitySchema = z.object({
  id: uuidSchema,
  organization_id: uuidSchema,
  lead_id: uuidSchema,
  action: z.string().max(255),
  details: z.record(z.unknown()).optional(),
  created_at: timestampSchema,
});
export type LeadActivity = z.infer<typeof LeadActivitySchema>;

export const AutomationRunSchema = z.object({
  id: uuidSchema,
  organization_id: uuidSchema,
  contact_id: uuidSchema,
  conversation_id: uuidSchema.optional(),
  campaign_type: CampaignType,
  template_key: z.string().max(255),
  idempotency_key: z.string().max(255),
  status: AutomationStatus,
  scheduled_for: timestampSchema,
  sent_at: timestampSchema.optional(),
  error: z.string().optional(),
  created_at: timestampSchema,
  updated_at: timestampSchema,
});
export type AutomationRun = z.infer<typeof AutomationRunSchema>;

export const AuditEventSchema = z.object({
  id: uuidSchema,
  organization_id: uuidSchema,
  action: AuditAction,
  entity_type: z.string().max(100),
  entity_id: uuidSchema.optional(),
  actor_id: uuidSchema.optional(),
  actor_type: z.enum(['user', 'system', 'agent']),
  details: z.record(z.unknown()).optional(),
  trace_id: z.string().max(255).optional(),
  created_at: timestampSchema,
});
export type AuditEvent = z.infer<typeof AuditEventSchema>;

export const IntegrationConnectionSchema = z.object({
  id: uuidSchema,
  organization_id: uuidSchema,
  provider: z.string().max(100),
  status: z.enum(['active', 'inactive', 'error']),
  config: z.record(z.unknown()).optional(),
  created_at: timestampSchema,
  updated_at: timestampSchema,
});
export type IntegrationConnection = z.infer<typeof IntegrationConnectionSchema>;

export const KnowledgeDocumentSchema = z.object({
  id: uuidSchema,
  organization_id: uuidSchema,
  title: z.string().max(500),
  source_path: z.string().max(1000),
  content_hash: z.string().max(64).optional(),
  status: z.enum(['active', 'processing', 'error', 'archived']),
  metadata: z.record(z.unknown()).optional(),
  created_at: timestampSchema,
  updated_at: timestampSchema,
});
export type KnowledgeDocument = z.infer<typeof KnowledgeDocumentSchema>;

export const KnowledgeChunkSchema = z.object({
  id: uuidSchema,
  organization_id: uuidSchema,
  document_id: uuidSchema,
  chunk_index: z.number().int().min(0),
  content: z.string(),
  metadata: z.record(z.unknown()).optional(),
  // embedding stored as vector in DB, represented as number[] in app
  embedding: z.array(z.number()).optional(),
  created_at: timestampSchema,
});
export type KnowledgeChunk = z.infer<typeof KnowledgeChunkSchema>;

export const MessageTemplateSchema = z.object({
  id: uuidSchema,
  organization_id: uuidSchema,
  template_key: z.string().max(255),
  name: z.string().max(255),
  content: z.string(),
  language: z.string().max(10).default('en'),
  status: z.enum(['approved', 'pending', 'rejected']),
  category: z.string().max(100),
  created_at: timestampSchema,
  updated_at: timestampSchema,
});
export type MessageTemplate = z.infer<typeof MessageTemplateSchema>;

export const OutboundMessageSendSchema = z.object({
  id: uuidSchema,
  organization_id: uuidSchema,
  contact_id: uuidSchema,
  conversation_id: uuidSchema.optional(),
  template_key: z.string().max(255),
  content: z.string(),
  status: z.enum(['queued', 'sent', 'delivered', 'failed']),
  provider_message_id: z.string().max(255).optional(),
  idempotency_key: z.string().max(255),
  sent_at: timestampSchema.optional(),
  error: z.string().optional(),
  created_at: timestampSchema,
  updated_at: timestampSchema,
});
export type OutboundMessageSend = z.infer<typeof OutboundMessageSendSchema>;
