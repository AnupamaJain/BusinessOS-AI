import type { Lead, LeadStage } from './types';
import { randomUUID } from 'crypto';

export class LeadService {
  private leadsStore: Lead[] = [];

  public upsertLead(params: {
    organizationId: string;
    contactId: string;
    conversationId?: string;
    serviceInterest: string;
    budgetRange?: string;
    purchaseTimeline?: string;
    qualificationSummary?: string;
    score?: number;
    idempotencyKey: string;
  }): { lead: Lead; created: boolean } {
    const existing = this.leadsStore.find(
      l => l.organizationId === params.organizationId && l.idempotencyKey === params.idempotencyKey
    );

    if (existing) {
      return { lead: existing, created: false };
    }

    const newLead: Lead = {
      id: randomUUID(),
      organizationId: params.organizationId,
      contactId: params.contactId,
      conversationId: params.conversationId,
      stage: (params.score ?? 50) >= 60 ? 'qualified' : 'contacted',
      serviceInterest: params.serviceInterest,
      budgetRange: params.budgetRange,
      purchaseTimeline: params.purchaseTimeline,
      qualificationSummary: params.qualificationSummary,
      score: params.score ?? 50,
      idempotencyKey: params.idempotencyKey,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    this.leadsStore.push(newLead);
    return { lead: newLead, created: true };
  }

  public updateStage(leadId: string, newStage: LeadStage): Lead | undefined {
    const lead = this.leadsStore.find(l => l.id === leadId);
    if (lead) {
      lead.stage = newStage;
      lead.updatedAt = new Date().toISOString();
    }
    return lead;
  }

  public getLeadsByOrganization(organizationId: string): Lead[] {
    return this.leadsStore.filter(l => l.organizationId === organizationId);
  }
}
