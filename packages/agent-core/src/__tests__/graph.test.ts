import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'crypto';
import { ToolDataStore } from '@whatsapp-smb/mcp-business-tools';
import { executeAgentGraph } from '../graph';

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
  store.orders.push({ id: 'order-1', organizationId: ORG_A, contactId: CONTACT_A, orderNumber: 'GR-12345', status: 'Shipped', totalAmount: '₹799', items: 'AquaShield SPF 50', estimatedDelivery: '2026-07-22' });
}

describe('Agent Graph Flow', () => {
  let store: ToolDataStore;
  beforeEach(() => {
    store = new ToolDataStore();
    seedStore(store);
  });

  it('runs sales enquiry successfully and qualifies lead', async () => {
    const params = {
      organizationId: ORG_A,
      contactId: CONTACT_A,
      conversationId: CONV_A,
      inboundMessage: 'I need a sunscreen for oily skin',
      traceId: 'trace-sales',
    };

    const finalState = await executeAgentGraph(store, params);
    expect(finalState.intent).toBe('sales_enquiry');
    expect(finalState.finalResponse).toContain('AquaShield SPF 50');
    expect(finalState.toolCalls.some((t) => t.tool === 'upsert_qualified_lead')).toBe(true);
    expect(store.leads.length).toBe(1);
    expect(store.leads[0]?.stage).toBe('qualified');
  });

  it('runs refund/complaint flow and creates human handoff', async () => {
    const params = {
      organizationId: ORG_A,
      contactId: CONTACT_A,
      conversationId: CONV_A,
      inboundMessage: 'I want a refund. Connect me to a person.',
      traceId: 'trace-refund',
    };

    const finalState = await executeAgentGraph(store, params);
    expect(finalState.intent).toBe('complaint_or_refund');
    expect(finalState.finalResponse).toContain('connecting you with a team member');
    expect(finalState.toolCalls.some((t) => t.tool === 'create_human_handoff')).toBe(true);
    expect(store.handoffs.length).toBe(1);
    expect(store.conversations[0]?.status).toBe('waiting_for_human');
  });

  it('runs opt-out flow', async () => {
    const params = {
      organizationId: ORG_A,
      contactId: CONTACT_A,
      conversationId: CONV_A,
      inboundMessage: 'Stop',
      traceId: 'trace-optout',
    };

    const finalState = await executeAgentGraph(store, params);
    expect(finalState.intent).toBe('opt_out');
    expect(finalState.finalResponse).toContain('unsubscribed');
  });

  it('retrieves order status successfully when order number is provided', async () => {
    const params = {
      organizationId: ORG_A,
      contactId: CONTACT_A,
      conversationId: CONV_A,
      inboundMessage: 'What is the status of my order GR-12345?',
      traceId: 'trace-order-status-ok',
    };

    const finalState = await executeAgentGraph(store, params);
    expect(finalState.intent).toBe('order_status');
    expect(finalState.finalResponse).toContain('Shipped');
    expect(finalState.toolCalls.some((t) => t.tool === 'get_order_status')).toBe(true);
  });

  it('prompts for order number when missing', async () => {
    const params = {
      organizationId: ORG_A,
      contactId: CONTACT_A,
      conversationId: CONV_A,
      inboundMessage: 'Where is my order?',
      traceId: 'trace-order-status-missing',
    };

    const finalState = await executeAgentGraph(store, params);
    expect(finalState.intent).toBe('order_status');
    expect(finalState.finalResponse).toContain('provide your order number');
    expect(finalState.toolCalls.length).toBe(0);
  });
});
