import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'crypto';
import { ToolDataStore } from '@business-os-ai/mcp-business-tools';
import { executeAgentGraph, type AgentGraphDeps } from '../graph';

const ORG_A = '11111111-1111-1111-1111-111111111111';
const CONTACT_A = randomUUID();
const CONV_A = randomUUID();

function seedStore(store: ToolDataStore) {
  store.contacts.push({ id: CONTACT_A, organizationId: ORG_A, phone: '+919876543210', name: 'Priya' });
  store.conversations.push({ id: CONV_A, organizationId: ORG_A, status: 'active' });
  store.consentRecords.push({ contactId: CONTACT_A, organizationId: ORG_A, consentType: 'marketing', action: 'opt_in' });
  store.products.push(
    { sku: 'GR-SUN-001', name: 'AquaShield SPF 50', price: '₹799', skinType: 'Oily, combination', description: 'Matte sunscreen for oily skin', suitableFor: 'Daily use', organizationId: ORG_A },
  );
  store.templates.push({ templateKey: 'qualified_lead_24h_followup', organizationId: ORG_A, status: 'approved' });
}

function baseParams(inboundMessage: string, traceId: string) {
  return { organizationId: ORG_A, contactId: CONTACT_A, conversationId: CONV_A, inboundMessage, traceId };
}

describe('Business rules & enabled AI-team roles', () => {
  let store: ToolDataStore;
  beforeEach(() => {
    store = new ToolDataStore();
    seedStore(store);
  });

  it('(a) escalates a discount request beyond the cap to a human, with the manager reply and no normal sale', async () => {
    const deps: AgentGraphDeps = { businessRules: { maxDiscountPercent: 10 } };
    const finalState = await executeAgentGraph(
      store,
      baseParams('I want to buy the sunscreen but can you give me 30% off?', 'trace-discount'),
      deps,
    );

    expect(finalState.intent).toBe('sales_enquiry');
    // Handoff created with the discount_approval semantic reason.
    const handoffCall = finalState.toolCalls.find((t) => t.tool === 'create_human_handoff');
    expect(handoffCall?.input.reason).toBe('discount_approval');
    expect(store.handoffs.length).toBe(1);
    expect(finalState.handoffId).toBeDefined();
    // Manager reply, and NOT a normal product sale.
    expect(finalState.finalResponse).toContain('check with my manager');
    expect(finalState.toolCalls.some((t) => t.tool === 'search_product_catalog')).toBe(false);
    expect(finalState.toolCalls.some((t) => t.tool === 'upsert_qualified_lead')).toBe(false);
    expect(store.leads.length).toBe(0);
  });

  it('(b) escalates a refund request to a human when refundRequiresApproval is set', async () => {
    const deps: AgentGraphDeps = { businessRules: { refundRequiresApproval: true } };
    const finalState = await executeAgentGraph(
      store,
      baseParams('I want a refund for my last order please', 'trace-refund-approval'),
      deps,
    );

    const handoffCall = finalState.toolCalls.find((t) => t.tool === 'create_human_handoff');
    expect(handoffCall?.input.reason).toBe('refund_approval');
    expect(store.handoffs.length).toBe(1);
    expect(finalState.finalResponse).toContain('passed your refund request');
  });

  it('(c) gates a booking_request to a handoff when the booking role is not enabled', async () => {
    const deps: AgentGraphDeps = { enabledAgents: ['support'] };
    const finalState = await executeAgentGraph(
      store,
      baseParams('I want to book an appointment for tomorrow', 'trace-role-disabled'),
      deps,
    );

    expect(finalState.intent).toBe('booking_request');
    const handoffCall = finalState.toolCalls.find((t) => t.tool === 'create_human_handoff');
    expect(handoffCall?.input.reason).toBe('role_disabled');
    expect(store.handoffs.length).toBe(1);
    expect(finalState.finalResponse).toContain('team will help you');
    // No booking side effects.
    expect(finalState.toolCalls.some((t) => t.tool === 'create_booking')).toBe(false);
    expect(finalState.toolCalls.some((t) => t.tool === 'offer_choices')).toBe(false);
  });

  it('(d) with businessRules undefined, a normal sales enquiry behaves exactly as before (no new handoffs)', async () => {
    const finalState = await executeAgentGraph(
      store,
      baseParams('I need a sunscreen for oily skin', 'trace-normal-sale'),
    );

    expect(finalState.intent).toBe('sales_enquiry');
    expect(finalState.finalResponse).toContain('AquaShield SPF 50');
    expect(finalState.toolCalls.some((t) => t.tool === 'upsert_qualified_lead')).toBe(true);
    expect(finalState.toolCalls.some((t) => t.tool === 'create_human_handoff')).toBe(false);
    expect(store.handoffs.length).toBe(0);
    expect(store.leads.length).toBe(1);
  });

  it('enabledAgents that includes the required role does NOT gate (sales enquiry proceeds)', async () => {
    const deps: AgentGraphDeps = { enabledAgents: ['sales', 'support'] };
    const finalState = await executeAgentGraph(
      store,
      baseParams('I need a sunscreen for oily skin', 'trace-role-enabled'),
      deps,
    );
    expect(finalState.finalResponse).toContain('AquaShield SPF 50');
    expect(store.handoffs.length).toBe(0);
  });
});
