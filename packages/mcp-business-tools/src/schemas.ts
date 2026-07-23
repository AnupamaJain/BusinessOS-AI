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

// ─── Cab (intercity) vertical ──────────────────────────────────────

export const SearchCabRoutesInput = z.object({
  organizationId: z.string().uuid(),
  fromCity: z.string().optional(),
  toCity: z.string().optional(),
  vehicleClass: z.enum(['sedan', 'suv', 'tempo']).optional(),
});
export type SearchCabRoutesInput = z.infer<typeof SearchCabRoutesInput>;

export const SearchCabRoutesOutput = z.object({
  routes: z.array(z.object({
    sku: z.string(),
    title: z.string(),
    fromCity: z.string(),
    toCity: z.string(),
    vehicleClass: z.string(),
    seats: z.number(),
    fare: z.string(),
    estimatedHours: z.number(),
    inclusions: z.array(z.string()),
  })),
});
export type SearchCabRoutesOutput = z.infer<typeof SearchCabRoutesOutput>;

export const CreateCabBookingInput = z.object({
  organizationId: z.string().uuid(),
  contactId: z.string().uuid(),
  packageSku: z.string(),
  pickupDate: z.string(),
  idempotencyKey: z.string(),
});
export type CreateCabBookingInput = z.infer<typeof CreateCabBookingInput>;

export const CreateCabBookingOutput = z.object({
  bookingId: z.string(),
  bookingNumber: z.string(),
  status: z.string(),
  totalAmount: z.string(),
});
export type CreateCabBookingOutput = z.infer<typeof CreateCabBookingOutput>;

// ─── Home services (maid) vertical ─────────────────────────────────

export const SearchServicePlansInput = z.object({
  organizationId: z.string().uuid(),
  service: z.enum(['cleaning', 'cooking', 'full-time', 'babysitting']).optional(),
  planType: z.enum(['one-time', 'monthly']).optional(),
});
export type SearchServicePlansInput = z.infer<typeof SearchServicePlansInput>;

export const SearchServicePlansOutput = z.object({
  plans: z.array(z.object({
    sku: z.string(),
    title: z.string(),
    service: z.string(),
    planType: z.string(),
    hoursPerVisit: z.number(),
    visitsPerMonth: z.number(),
    area: z.string(),
    price: z.string(),
    inclusions: z.array(z.string()),
  })),
});
export type SearchServicePlansOutput = z.infer<typeof SearchServicePlansOutput>;

export const CreateServiceBookingInput = z.object({
  organizationId: z.string().uuid(),
  contactId: z.string().uuid(),
  packageSku: z.string(),
  startDate: z.string(),
  idempotencyKey: z.string(),
});
export type CreateServiceBookingInput = z.infer<typeof CreateServiceBookingInput>;

export const CreateServiceBookingOutput = z.object({
  bookingId: z.string(),
  bookingNumber: z.string(),
  status: z.string(),
  totalAmount: z.string(),
});
export type CreateServiceBookingOutput = z.infer<typeof CreateServiceBookingOutput>;

// ─── OpenMontage Multi-Modal Media Generation ─────────────────────

export const GeneratePromoMediaInput = z.object({
  organizationId: z.string().uuid(),
  campaignType: z.enum(['travel_itinerary_video', 'product_teaser', 'promo_reel', 'voice_narration']),
  topic: z.string().min(1).max(500),
  style: z.enum(['cinematic', 'anime', 'documentary', 'product_ad', 'travel_reel']).default('travel_reel'),
  durationSec: z.number().int().min(5).max(60).default(15),
  targetChannel: z.enum(['whatsapp', 'instagram']).default('whatsapp'),
});
export type GeneratePromoMediaInput = z.infer<typeof GeneratePromoMediaInput>;

export const GeneratePromoMediaOutput = z.object({
  success: z.boolean(),
  mediaUrl: z.string(),
  mediaType: z.enum(['video', 'image', 'audio']),
  durationSec: z.number(),
  caption: z.string(),
  providerUsed: z.string(),
});
export type GeneratePromoMediaOutput = z.infer<typeof GeneratePromoMediaOutput>;

// ─── Growth Services Suite (Local SEO, SEO Marketing, Lead Gen, Chat Automation) ───

export const AnalyzeLocalSeoInput = z.object({
  organizationId: z.string().uuid(),
  businessName: z.string().min(1),
  city: z.string().min(1),
  targetKeywords: z.array(z.string()).default(['local services', 'near me']),
});
export type AnalyzeLocalSeoInput = z.infer<typeof AnalyzeLocalSeoInput>;

export const AnalyzeLocalSeoOutput = z.object({
  napScore: z.number(),
  localRankings: z.array(z.object({
    keyword: z.string(),
    position: z.number(),
    searchVolume: z.number(),
  })),
  recommendations: z.array(z.string()),
  citationsBuilt: z.number(),
});
export type AnalyzeLocalSeoOutput = z.infer<typeof AnalyzeLocalSeoOutput>;

export const RunSeoAuditInput = z.object({
  organizationId: z.string().uuid(),
  websiteUrl: z.string().url(),
  depth: z.enum(['quick', 'full']).default('quick'),
});
export type RunSeoAuditInput = z.infer<typeof RunSeoAuditInput>;

export const RunSeoAuditOutput = z.object({
  healthScore: z.number(),
  totalImpressions: z.string(),
  averageCtr: z.string(),
  averagePosition: z.number(),
  technicalIssues: z.array(z.string()),
  contentOpportunities: z.array(z.string()),
});
export type RunSeoAuditOutput = z.infer<typeof RunSeoAuditOutput>;

export const ManageLeadFunnelInput = z.object({
  organizationId: z.string().uuid(),
  campaignName: z.string().min(1),
  targetAudience: z.string().min(1),
  monthlyBudgetInr: z.number().positive(),
  channel: z.enum(['paid_ads', 'whatsapp_funnel', 'b2b_outreach', 'all']).default('all'),
});
export type ManageLeadFunnelInput = z.infer<typeof ManageLeadFunnelInput>;

export const ManageLeadFunnelOutput = z.object({
  funnelId: z.string(),
  status: z.string(),
  expectedLeadsPerMonth: z.number(),
  estimatedCacInr: z.number(),
  conversionRatePercent: z.number(),
  nurturingSequence: z.array(z.string()),
});
export type ManageLeadFunnelOutput = z.infer<typeof ManageLeadFunnelOutput>;

export const ConfigureChatAutomationInput = z.object({
  organizationId: z.string().uuid(),
  channels: z.array(z.enum(['whatsapp', 'messenger', 'website_widget'])).min(1),
  enable247Replies: z.boolean().default(true),
  autoBooking: z.boolean().default(true),
});
export type ConfigureChatAutomationInput = z.infer<typeof ConfigureChatAutomationInput>;

export const ConfigureChatAutomationOutput = z.object({
  automationId: z.string(),
  activeChannels: z.array(z.string()),
  botStatus: z.string(),
  handOffEscalationRule: z.string(),
});
export type ConfigureChatAutomationOutput = z.infer<typeof ConfigureChatAutomationOutput>;


