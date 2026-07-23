import { describe, it, expect } from 'vitest';
import {
  ToolDataStore,
  analyzeLocalSeo,
  runSeoAudit,
  manageLeadFunnel,
  configureChatAutomation,
} from '../index';

describe('Growth Services MCP Tools', () => {
  const orgId = '11111111-1111-1111-1111-111111111111';

  it('analyzes Local Business SEO with NAP consistency & local rankings', async () => {
    const store = new ToolDataStore();
    const result = await analyzeLocalSeo(store, {
      organizationId: orgId,
      businessName: 'SaarthiOne Travels',
      city: 'Mumbai',
      targetKeywords: ['best travel agency', 'custom bali tour package'],
    });

    expect(result.napScore).toBeGreaterThanOrEqual(90);
    expect(result.localRankings.length).toBe(2);
    expect(result.citationsBuilt).toBeGreaterThan(0);
    expect(store.auditEvents[0]?.action).toBe('local_seo_analyzed');
  });

  it('runs SEO marketing audit for website health & impressions', async () => {
    const store = new ToolDataStore();
    const result = await runSeoAudit(store, {
      organizationId: orgId,
      websiteUrl: 'https://saarthione.vercel.app',
      depth: 'quick',
    });

    expect(result.healthScore).toBe(88);
    expect(result.totalImpressions).toBe('17.6K');
    expect(result.averageCtr).toBe('1.3%');
    expect(result.averagePosition).toBe(25.2);
    expect(store.auditEvents[0]?.action).toBe('seo_audit_executed');
  });

  it('configures targeted lead generation funnel with CAC optimization', async () => {
    const store = new ToolDataStore();
    const result = await manageLeadFunnel(store, {
      organizationId: orgId,
      campaignName: 'Q3 High Intent SMB Leads',
      targetAudience: 'Small Business Owners & Travel Planners',
      monthlyBudgetInr: 45000,
      channel: 'all',
    });

    expect(result.funnelId).toContain('funnel-');
    expect(result.status).toBe('active');
    expect(result.expectedLeadsPerMonth).toBe(100);
    expect(result.estimatedCacInr).toBe(450);
    expect(store.auditEvents[0]?.action).toBe('lead_funnel_created');
  });

  it('configures multi-channel chat automation (WhatsApp, Messenger, Website Widget)', async () => {
    const store = new ToolDataStore();
    const result = await configureChatAutomation(store, {
      organizationId: orgId,
      channels: ['whatsapp', 'messenger', 'website_widget'],
      enable247Replies: true,
      autoBooking: true,
    });

    expect(result.automationId).toContain('bot-');
    expect(result.activeChannels.length).toBe(3);
    expect(result.botStatus).toBe('live_24x7');
    expect(store.auditEvents[0]?.action).toBe('chat_automation_configured');
  });
});
