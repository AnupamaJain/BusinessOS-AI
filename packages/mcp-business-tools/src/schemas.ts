import { z } from 'zod';

// ─── Tool Input/Output Schemas ─────────────────────────────────────

export const GetCustomerContextInput = z.object({
  organizationId: z.string().uuid(),
  contactId: z.string().uuid(),
  conversationId: z.string().uuid(),
  requestedFields: z.array(z.enum(['profile', 'consent', 'lead', 'messages', 'handoff'])).default(['profile', 'consent', 'lead', 'messages', 'handoff']),
});
export type GetCustomerContextInput = z.infer<typeof GetCustomerContextInput>;

export const GetCustomerContextOutput = z.object({
  contact: z.object({
    id: z.string(),
    name: z.string().optional(),
    phone: z.string(),
  }),
  consentStatus: z.object({
    marketing: z.enum(['opted_in', 'opted_out', 'unknown']),
    transactional: z.enum(['opted_in', 'opted_out', 'unknown']),
  }),
  latestLead: z.object({
    id: z.string(),
    stage: z.string(),
    serviceInterest: z.string(),
    score: z.number().optional(),
  }).optional(),
  recentMessages: z.array(z.object({
    direction: z.enum(['inbound', 'outbound']),
    content: z.string(),
    createdAt: z.string(),
  })),
  openHandoff: z.object({
    id: z.string(),
    status: z.string(),
    reason: z.string(),
  }).optional(),
});
export type GetCustomerContextOutput = z.infer<typeof GetCustomerContextOutput>;

export const UpsertQualifiedLeadInput = z.object({
  organizationId: z.string().uuid(),
  contactId: z.string().uuid(),
  conversationId: z.string().uuid(),
  serviceInterest: z.string().min(1).max(500),
  budgetRange: z.string().max(100).optional(),
  purchaseTimeline: z.string().max(100).optional(),
  qualificationSummary: z.string().max(2000),
  score: z.number().int().min(0).max(100),
  idempotencyKey: z.string().min(1).max(255),
});
export type UpsertQualifiedLeadInput = z.infer<typeof UpsertQualifiedLeadInput>;

export const UpsertQualifiedLeadOutput = z.object({
  leadId: z.string(),
  action: z.enum(['created', 'updated']),
  stage: z.string(),
});

export const CreateHumanHandoffInput = z.object({
  organizationId: z.string().uuid(),
  contactId: z.string().uuid(),
  conversationId: z.string().uuid(),
  reason: z.enum(['customer_request', 'complaint_or_refund', 'payment_issue', 'legal_or_medical', 'low_confidence', 'repeated_failure', 'integration_error', 'unsafe_request']),
  priority: z.enum(['low', 'medium', 'high', 'urgent']),
  summary: z.string().min(1).max(2000),
  idempotencyKey: z.string().min(1).max(255),
});
export type CreateHumanHandoffInput = z.infer<typeof CreateHumanHandoffInput>;

export const CreateHumanHandoffOutput = z.object({
  handoffId: z.string(),
  conversationStatus: z.string(),
});

export const SearchProductCatalogInput = z.object({
  organizationId: z.string().uuid(),
  query: z.string().min(1),
  skinType: z.string().optional(),
  concern: z.string().optional(),
});
export type SearchProductCatalogInput = z.infer<typeof SearchProductCatalogInput>;

export const SearchProductCatalogOutput = z.object({
  products: z.array(z.object({
    sku: z.string(),
    name: z.string(),
    price: z.string(),
    skinType: z.string(),
    description: z.string(),
    suitableFor: z.string(),
  })),
});

export const RequestFollowupScheduleInput = z.object({
  organizationId: z.string().uuid(),
  contactId: z.string().uuid(),
  conversationId: z.string().uuid(),
  templateKey: z.string().min(1).max(255),
  scheduledFor: z.coerce.date(),
  campaignType: z.enum(['qualified_lead_followup', 'appointment_reminder', 'reorder_reminder', 'abandoned_enquiry']),
  idempotencyKey: z.string().min(1).max(255),
});
export type RequestFollowupScheduleInput = z.infer<typeof RequestFollowupScheduleInput>;

export const RequestFollowupScheduleOutput = z.object({
  automationRunId: z.string(),
  status: z.string(),
  scheduledFor: z.string(),
});

export const GetOrderStatusInput = z.object({
  organizationId: z.string().uuid(),
  contactId: z.string().uuid(),
  orderNumber: z.string().min(1).max(100),
});
export type GetOrderStatusInput = z.infer<typeof GetOrderStatusInput>;

export const GetOrderStatusOutput = z.object({
  found: z.boolean(),
  order: z.object({
    orderNumber: z.string(),
    status: z.string(),
    totalAmount: z.string(),
    items: z.string(),
    estimatedDelivery: z.string(),
  }).optional(),
});
export type GetOrderStatusOutput = z.infer<typeof GetOrderStatusOutput>;

export const SearchTravelPackagesInput = z.object({
  organizationId: z.string().uuid(),
  destination: z.string().optional(),
  maxBudgetPerPerson: z.number().optional(),
  durationDays: z.number().optional(),
});
export type SearchTravelPackagesInput = z.infer<typeof SearchTravelPackagesInput>;

export const SearchTravelPackagesOutput = z.object({
  packages: z.array(z.object({
    sku: z.string(),
    title: z.string(),
    destination: z.string(),
    durationDays: z.number(),
    pricePerPerson: z.string(),
    inclusions: z.array(z.string()),
  })),
});
export type SearchTravelPackagesOutput = z.infer<typeof SearchTravelPackagesOutput>;

export const CreateTravelBookingInput = z.object({
  organizationId: z.string().uuid(),
  contactId: z.string().uuid(),
  packageSku: z.string(),
  travelDate: z.string(),
  travelerCount: z.number().min(1).default(1),
  idempotencyKey: z.string(),
});
export type CreateTravelBookingInput = z.infer<typeof CreateTravelBookingInput>;

export const CreateTravelBookingOutput = z.object({
  bookingId: z.string(),
  bookingNumber: z.string(),
  status: z.string(),
  totalAmount: z.string(),
});
export type CreateTravelBookingOutput = z.infer<typeof CreateTravelBookingOutput>;
