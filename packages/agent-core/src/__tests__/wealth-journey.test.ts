import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'crypto';
import { ToolDataStore } from '@business-os-ai/mcp-business-tools';
import type { PackageRecord } from '@business-os-ai/mcp-business-tools';
import { executeAgentGraph } from '../graph';
import type { AgentGraphDeps } from '../graph';

const ORG = '55555555-5555-5555-5555-555555555555';
const CONTACT = randomUUID();
const CONV = randomUUID();

function plan(sku: string, title: string, minInvestment: number, riskBand: string, horizonYears: number, lockInMonths = 0): PackageRecord {
  return {
    sku, title, destination: '', durationDays: 1, pricePerPerson: minInvestment, currency: 'INR',
    inclusions: ['Zero-commission direct funds', 'SEBI-registered advisor access'],
    organizationId: ORG,
    metadata: { type: 'investment-plan', mode: 'SIP', category: 'equity', riskBand, horizonYears, lockInMonths },
  };
}

function seedStore(store: ToolDataStore) {
  store.contacts.push({ id: CONTACT, organizationId: ORG, phone: '+919810055555', name: 'Neha' });
  store.conversations.push({ id: CONV, organizationId: ORG, status: 'active' });
  store.consentRecords.push({ contactId: CONTACT, organizationId: ORG, consentType: 'marketing', action: 'opt_in' });
  store.packages.push(
    plan('VX-SIP-INDEX', 'SIP Starter — Nifty 50 Index Fund', 500, 'Moderate', 5),
    plan('VX-ELSS-TAX', 'Tax Saver ELSS (80C)', 500, 'Moderately High', 3, 36),
    plan('VX-LIQUID', 'Emergency Fund — Liquid Fund', 1000, 'Low', 1),
  );
}

// No LLM in deps → the graph uses its deterministic fallbacks, which is exactly
// what we want to assert (routing + compliance copy), independent of any model.
const WEALTH: AgentGraphDeps = { vertical: 'financial-services', businessName: 'VriddhiX' };
function params(inboundMessage: string, traceId: string) {
  return { organizationId: ORG, contactId: CONTACT, conversationId: CONV, inboundMessage, traceId };
}

describe('VriddhiX wealth journey — positive', () => {
  let store: ToolDataStore;
  beforeEach(() => { store = new ToolDataStore(); seedStore(store); });

  it('routes a wealth enquiry to the wealth flow, grounds on the catalog, and qualifies a lead', async () => {
    const state = await executeAgentGraph(store, params('I want to start investing in mutual funds', 't-w1'), WEALTH);
    expect(state.intent).toBe('sales_enquiry');
    expect(state.toolCalls.some((t) => t.tool === 'search_wealth_plans')).toBe(true);
    expect(state.toolCalls.some((t) => t.tool === 'search_product_catalog')).toBe(false);
    expect(state.finalResponse).toContain('SIP Starter'); // real plan name from the catalog
    expect(state.finalResponse!.toLowerCase()).toContain('market risk'); // compliance
    expect(state.toolCalls.some((t) => t.tool === 'upsert_qualified_lead')).toBe(true);
    expect(store.leads.length).toBe(1);
  });

  it('triggers on wealth keywords even without the vertical set', async () => {
    const state = await executeAgentGraph(store, params('Can I start a SIP?', 't-w2'), { businessName: 'VriddhiX' });
    expect(state.toolCalls.some((t) => t.tool === 'search_wealth_plans')).toBe(true);
    expect(state.finalResponse!.toLowerCase()).toContain('market risk');
  });
});

describe('VriddhiX wealth journey — booking hands off to an advisor', () => {
  let store: ToolDataStore;
  beforeEach(() => { store = new ToolDataStore(); seedStore(store); });

  it('creates a human handoff (advisor) on a booking intent, never executes in-chat', async () => {
    const state = await executeAgentGraph(store, params('Book the SIP Starter plan to get started', 't-w3'), WEALTH);
    expect(state.intent).toBe('booking_request');
    expect(state.toolCalls.some((t) => t.tool === 'create_human_handoff')).toBe(true);
    expect(state.finalResponse!.toLowerCase()).toContain('sebi');
    expect(state.finalResponse!.toLowerCase()).toContain('market risk');
  });
});

describe('VriddhiX wealth journey — compliance (negative)', () => {
  let store: ToolDataStore;
  beforeEach(() => { store = new ToolDataStore(); seedStore(store); });

  it('never promises a guarantee even when the customer demands one', async () => {
    // (Uses investment phrasing that classifies deterministically as a sales
    //  enquiry; the live LLM path additionally rebuts the guarantee explicitly.)
    const state = await executeAgentGraph(store, params('Just promise me my money will surely double if I invest in a SIP', 't-w4'), WEALTH);
    const reply = state.finalResponse!.toLowerCase();
    expect(state.intent).toBe('sales_enquiry');
    expect(reply).toContain('market risk'); // compliance disclaimer always present
    expect(reply).not.toMatch(/\bguarantee/); // never uses the word "guarantee"
  });
});
