import { describe, it, expect, beforeEach } from 'vitest';
import { CampaignService, WorkflowService } from '../index';

const ORG_A = '11111111-1111-1111-1111-111111111111';

describe('Marketing Package', () => {
  let campaignService: CampaignService;
  let workflowService: WorkflowService;

  beforeEach(() => {
    campaignService = new CampaignService();
    workflowService = new WorkflowService();
  });

  it('creates and updates broadcast campaigns', () => {
    const campaign = campaignService.createCampaign({
      organizationId: ORG_A,
      name: 'Bali October Special Offer',
      templateKey: 'qualified_lead_24h_followup',
      targetSegment: 'Qualified Leads (Score >= 70)',
      scheduledFor: '2026-08-01 10:00:00 (UTC)',
      totalRecipients: 150
    });

    expect(campaign.id).toBeDefined();
    expect(campaign.status).toBe('scheduled');
    expect(campaign.metrics.totalRecipients).toBe(150);

    const updated = campaignService.updateCampaignStatus(campaign.id, 'completed');
    expect(updated?.status).toBe('completed');
  });

  it('evaluates event-driven workflow rules correctly', () => {
    workflowService.createWorkflowRule({
      organizationId: ORG_A,
      name: 'High Score Lead Followup',
      triggerEvent: 'lead_qualified',
      conditions: [{ field: 'score', operator: 'greater_than', value: 70 }],
      action: { type: 'send_template', templateKey: 'qualified_lead_24h_followup' }
    });

    const matching = workflowService.evaluateEvent(ORG_A, 'lead_qualified', { score: 85 });
    expect(matching.length).toBe(1);
    expect(matching[0]?.name).toBe('High Score Lead Followup');

    const nonMatching = workflowService.evaluateEvent(ORG_A, 'lead_qualified', { score: 50 });
    expect(nonMatching.length).toBe(0);
  });
});
