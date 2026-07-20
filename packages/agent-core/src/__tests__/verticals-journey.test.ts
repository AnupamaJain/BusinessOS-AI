import { describe, it, expect, beforeEach, vi } from 'vitest';
import { randomUUID } from 'crypto';
import { ToolDataStore } from '@business-os-ai/mcp-business-tools';
import type { PackageRecord } from '@business-os-ai/mcp-business-tools';
import { executeAgentGraph } from '../graph';
import type { AgentGraphDeps } from '../graph';

const ORG = '11111111-1111-1111-1111-111111111111';
const CONTACT = randomUUID();
const CONV = randomUUID();

function seedStore(store: ToolDataStore) {
  store.contacts.push({ id: CONTACT, organizationId: ORG, phone: '+919876543210', name: 'Priya' });
  store.conversations.push({ id: CONV, organizationId: ORG, status: 'active' });
  store.consentRecords.push({ contactId: CONTACT, organizationId: ORG, consentType: 'marketing', action: 'opt_in' });

  const cab: PackageRecord = {
    sku: 'CAB-DEL-JAI-SEDAN', title: 'Delhi → Jaipur · Sedan', destination: 'Jaipur',
    durationDays: 0, pricePerPerson: 3500, currency: 'INR',
    inclusions: ['Tolls & taxes included', 'Professional driver', 'Doorstep pickup'],
    organizationId: ORG,
    metadata: { type: 'cab-route', fromCity: 'Delhi', toCity: 'Jaipur', vehicleClass: 'sedan', seats: 4, estimatedHours: 5 },
  };
  const service: PackageRecord = {
    sku: 'SVC-COOK-MONTHLY', title: 'Monthly Cooking · 2 hrs/day', destination: 'HSR Layout',
    durationDays: 0, pricePerPerson: 6000, currency: 'INR',
    inclusions: ['Background-verified staff', 'Free replacement', 'Supplies included'],
    organizationId: ORG,
    metadata: { type: 'home-service', service: 'cooking', planType: 'monthly', hoursPerVisit: 2, visitsPerMonth: 30, area: 'HSR Layout' },
  };
  store.packages.push(cab, service);
}

function baseParams(inboundMessage: string, traceId: string) {
  return { organizationId: ORG, contactId: CONTACT, conversationId: CONV, inboundMessage, traceId };
}

describe('Cab (intercity) journey', () => {
  let store: ToolDataStore;
  beforeEach(() => { store = new ToolDataStore(); seedStore(store); });

  it('returns cab routes and pushes search_cab_routes on a cab enquiry', async () => {
    const state = await executeAgentGraph(store, baseParams('I need a cab from Delhi to Jaipur', 'trace-cab-sales'));

    expect(state.intent).toBe('sales_enquiry');
    expect(state.toolCalls.some((t) => t.tool === 'search_cab_routes')).toBe(true);
    expect(state.toolCalls.some((t) => t.tool === 'search_travel_packages')).toBe(false);
    expect(state.toolCalls.some((t) => t.tool === 'search_product_catalog')).toBe(false);
    expect(state.finalResponse).toContain('Delhi → Jaipur · Sedan');
    expect(state.finalResponse).toContain('₹3,500');
    expect(state.toolCalls.some((t) => t.tool === 'upsert_qualified_lead')).toBe(true);
    expect(store.leads.length).toBe(1);
  });

  it('books the cab and surfaces the payment link when a date is present', async () => {
    const createCabBooking = vi.fn(async (_a: { contactId: string; packageSku: string; pickupDate: string }) => ({
      url: 'https://pay.example.com/cab/abc123', amountText: '₹3,500', bookingNumber: 'BK-55501',
    }));
    const deps: AgentGraphDeps = { vertical: 'cab-intercity', createCabBooking };

    const state = await executeAgentGraph(
      store, baseParams('Book the Delhi to Jaipur sedan cab for tomorrow', 'trace-cab-book'), deps,
    );

    expect(state.intent).toBe('booking_request');
    expect(createCabBooking).toHaveBeenCalledTimes(1);
    expect(createCabBooking.mock.calls[0]![0]).toMatchObject({ contactId: CONTACT, packageSku: 'CAB-DEL-JAI-SEDAN' });
    expect(state.toolCalls.some((t) => t.tool === 'create_cab_booking')).toBe(true);
    expect(state.finalResponse).toContain('https://pay.example.com/cab/abc123');
    expect(state.finalResponse).toContain('BK-55501');
  });

  it('offers a date picker when a cab route is chosen but no date yet', async () => {
    const state = await executeAgentGraph(
      store, baseParams('Book the Delhi to Jaipur sedan cab', 'trace-cab-datepick'), { vertical: 'cab-intercity' },
    );
    expect(state.toolCalls.some((t) => t.tool === 'offer_choices')).toBe(true);
  });
});

describe('Home services (maid) journey', () => {
  let store: ToolDataStore;
  beforeEach(() => { store = new ToolDataStore(); seedStore(store); });

  it('returns service plans and pushes search_service_plans on a maid enquiry', async () => {
    const state = await executeAgentGraph(store, baseParams('I am looking for a maid for cooking', 'trace-svc-sales'));

    expect(state.intent).toBe('sales_enquiry');
    expect(state.toolCalls.some((t) => t.tool === 'search_service_plans')).toBe(true);
    expect(state.toolCalls.some((t) => t.tool === 'search_product_catalog')).toBe(false);
    expect(state.finalResponse).toContain('Monthly Cooking · 2 hrs/day');
    expect(state.finalResponse).toContain('₹6,000');
    expect(state.toolCalls.some((t) => t.tool === 'upsert_qualified_lead')).toBe(true);
    expect(store.leads.length).toBe(1);
  });

  it('books the service and surfaces the payment link when a start date is present', async () => {
    const createServiceBooking = vi.fn(async (_a: { contactId: string; packageSku: string; startDate: string }) => ({
      url: 'https://pay.example.com/svc/xyz789', amountText: '₹6,000', bookingNumber: 'BK-66601',
    }));
    const deps: AgentGraphDeps = { vertical: 'home-services', createServiceBooking };

    const state = await executeAgentGraph(
      store, baseParams('Book the monthly cooking plan starting tomorrow', 'trace-svc-book'), deps,
    );

    expect(state.intent).toBe('booking_request');
    expect(createServiceBooking).toHaveBeenCalledTimes(1);
    expect(createServiceBooking.mock.calls[0]![0]).toMatchObject({ contactId: CONTACT, packageSku: 'SVC-COOK-MONTHLY' });
    expect(state.toolCalls.some((t) => t.tool === 'create_service_booking')).toBe(true);
    expect(state.finalResponse).toContain('https://pay.example.com/svc/xyz789');
    expect(state.finalResponse).toContain('BK-66601');
  });
});
