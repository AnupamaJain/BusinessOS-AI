export type CampaignStatus = 'draft' | 'scheduled' | 'running' | 'completed' | 'cancelled';

export interface Campaign {
  id: string;
  organizationId: string;
  name: string;
  templateKey: string;
  targetSegment: string;
  scheduledFor: string;
  status: CampaignStatus;
  metrics: {
    totalRecipients: number;
    sentCount: number;
    deliveredCount: number;
    readCount: number;
    repliedCount: number;
  };
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowRule {
  id: string;
  organizationId: string;
  name: string;
  triggerEvent: 'lead_qualified' | 'booking_created' | 'quote_sent' | 'abandoned_cart';
  conditions: Array<{ field: string; operator: 'equals' | 'greater_than'; value: string | number }>;
  action: { type: 'send_template' | 'assign_agent' | 'apply_tag'; templateKey?: string };
  isActive: boolean;
}
