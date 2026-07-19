import type { Campaign, CampaignStatus } from './types';
import { randomUUID } from 'crypto';

export class CampaignService {
  private campaignsStore: Campaign[] = [];

  public createCampaign(params: {
    organizationId: string;
    name: string;
    templateKey: string;
    targetSegment: string;
    scheduledFor: string;
    totalRecipients: number;
  }): Campaign {
    const campaign: Campaign = {
      id: randomUUID(),
      organizationId: params.organizationId,
      name: params.name,
      templateKey: params.templateKey,
      targetSegment: params.targetSegment,
      scheduledFor: params.scheduledFor,
      status: 'scheduled',
      metrics: {
        totalRecipients: params.totalRecipients,
        sentCount: 0,
        deliveredCount: 0,
        readCount: 0,
        repliedCount: 0
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    this.campaignsStore.push(campaign);
    return campaign;
  }

  public updateCampaignStatus(campaignId: string, status: CampaignStatus): Campaign | undefined {
    const campaign = this.campaignsStore.find(c => c.id === campaignId);
    if (campaign) {
      campaign.status = status;
      campaign.updatedAt = new Date().toISOString();
    }
    return campaign;
  }

  public getCampaignsByOrganization(organizationId: string): Campaign[] {
    return this.campaignsStore.filter(c => c.organizationId === organizationId);
  }
}
