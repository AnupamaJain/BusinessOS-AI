import { z } from 'zod';

export type LeadStage = 'new' | 'contacted' | 'qualified' | 'proposal' | 'negotiation' | 'won' | 'lost' | 'disqualified';

export interface Lead {
  id: string;
  organizationId: string;
  contactId: string;
  conversationId?: string;
  stage: LeadStage;
  serviceInterest: string;
  budgetRange?: string;
  purchaseTimeline?: string;
  qualificationSummary?: string;
  score: number;
  ownerId?: string;
  idempotencyKey: string;
  createdAt: string;
  updatedAt: string;
}

export interface Contact {
  id: string;
  organizationId: string;
  phoneNumber: string;
  name?: string;
  email?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export const UpsertLeadInputSchema = z.object({
  organizationId: z.string().uuid(),
  contactId: z.string().uuid(),
  conversationId: z.string().uuid().optional(),
  serviceInterest: z.string().max(500),
  budgetRange: z.string().max(100).optional(),
  purchaseTimeline: z.string().max(100).optional(),
  qualificationSummary: z.string().max(2000).optional(),
  score: z.number().min(0).max(100).default(50),
  idempotencyKey: z.string()
});
