import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'crypto';
import {
  ToolDataStore,
  searchCabRoutes, createCabBooking,
  searchServicePlans, createServiceBooking,
} from '../tools';
import type { PackageRecord } from '../store';

const ORG_A = '11111111-1111-1111-1111-111111111111';
const CONTACT_A = randomUUID();

function cabPackage(over: Partial<PackageRecord> & { metadata: Record<string, unknown> }): PackageRecord {
  return {
    sku: 'CAB-001', title: 'Delhi → Jaipur · Sedan', destination: 'Jaipur',
    durationDays: 0, pricePerPerson: 3500, currency: 'INR',
    inclusions: ['Tolls & taxes included', 'Professional driver', 'Doorstep pickup'],
    organizationId: ORG_A, ...over,
  };
}

function servicePackage(over: Partial<PackageRecord> & { metadata: Record<string, unknown> }): PackageRecord {
  return {
    sku: 'SVC-001', title: 'Monthly Cooking · 2 hrs/day', destination: 'HSR Layout',
    durationDays: 0, pricePerPerson: 6000, currency: 'INR',
    inclusions: ['Background-verified staff', 'Free replacement', 'Supplies included'],
    organizationId: ORG_A, ...over,
  };
}

function seed(store: ToolDataStore) {
  store.contacts.push({ id: CONTACT_A, organizationId: ORG_A, phone: '+919876543210', name: 'Priya' });
  store.packages.push(
    cabPackage({ sku: 'CAB-DEL-JAI-SEDAN', metadata: { type: 'cab-route', fromCity: 'Delhi', toCity: 'Jaipur', vehicleClass: 'sedan', seats: 4, oneWay: true, estimatedHours: 5 } }),
    cabPackage({ sku: 'CAB-DEL-JAI-SUV', title: 'Delhi → Jaipur · SUV', pricePerPerson: 5200, metadata: { type: 'cab-route', fromCity: 'Delhi', toCity: 'Jaipur', vehicleClass: 'suv', seats: 6, oneWay: true, estimatedHours: 5 } }),
    cabPackage({ sku: 'CAB-MUM-PUN-SEDAN', title: 'Mumbai → Pune · Sedan', destination: 'Pune', pricePerPerson: 2800, metadata: { type: 'cab-route', fromCity: 'Mumbai', toCity: 'Pune', vehicleClass: 'sedan', seats: 4, oneWay: true, estimatedHours: 3 } }),
    servicePackage({ sku: 'SVC-COOK-MONTHLY', metadata: { type: 'home-service', service: 'cooking', planType: 'monthly', hoursPerVisit: 2, visitsPerMonth: 30, area: 'HSR Layout' } }),
    servicePackage({ sku: 'SVC-CLEAN-ONETIME', title: 'One-time Deep Clean', pricePerPerson: 1500, metadata: { type: 'home-service', service: 'cleaning', planType: 'one-time', hoursPerVisit: 4, visitsPerMonth: 1, area: 'Indiranagar' } }),
  );
}

describe('searchCabRoutes', () => {
  let store: ToolDataStore;
  beforeEach(() => { store = new ToolDataStore(); seed(store); });

  it('returns all cab routes with fare and metadata fields', async () => {
    const { routes } = await searchCabRoutes(store, { organizationId: ORG_A });
    expect(routes.length).toBe(3);
    const sedan = routes.find((r) => r.sku === 'CAB-DEL-JAI-SEDAN')!;
    expect(sedan.fromCity).toBe('Delhi');
    expect(sedan.toCity).toBe('Jaipur');
    expect(sedan.vehicleClass).toBe('sedan');
    expect(sedan.seats).toBe(4);
    expect(sedan.estimatedHours).toBe(5);
    expect(sedan.fare).toBe('₹3,500');
    expect(sedan.inclusions).toContain('Professional driver');
  });

  it('filters by fromCity (case-insensitive)', async () => {
    const { routes } = await searchCabRoutes(store, { organizationId: ORG_A, fromCity: 'delhi' });
    expect(routes.length).toBe(2);
    expect(routes.every((r) => r.fromCity === 'Delhi')).toBe(true);
  });

  it('filters by vehicleClass', async () => {
    const { routes } = await searchCabRoutes(store, { organizationId: ORG_A, vehicleClass: 'suv' });
    expect(routes.length).toBe(1);
    expect(routes[0]!.sku).toBe('CAB-DEL-JAI-SUV');
  });
});

describe('searchServicePlans', () => {
  let store: ToolDataStore;
  beforeEach(() => { store = new ToolDataStore(); seed(store); });

  it('returns service plans with metadata fields', async () => {
    const { plans } = await searchServicePlans(store, { organizationId: ORG_A });
    expect(plans.length).toBe(2);
    const cooking = plans.find((p) => p.sku === 'SVC-COOK-MONTHLY')!;
    expect(cooking.service).toBe('cooking');
    expect(cooking.planType).toBe('monthly');
    expect(cooking.hoursPerVisit).toBe(2);
    expect(cooking.visitsPerMonth).toBe(30);
    expect(cooking.area).toBe('HSR Layout');
    expect(cooking.price).toBe('₹6,000');
  });

  it('filters by service', async () => {
    const { plans } = await searchServicePlans(store, { organizationId: ORG_A, service: 'cleaning' });
    expect(plans.length).toBe(1);
    expect(plans[0]!.sku).toBe('SVC-CLEAN-ONETIME');
  });

  it('filters by planType', async () => {
    const { plans } = await searchServicePlans(store, { organizationId: ORG_A, planType: 'monthly' });
    expect(plans.length).toBe(1);
    expect(plans[0]!.service).toBe('cooking');
  });
});

describe('createCabBooking', () => {
  let store: ToolDataStore;
  beforeEach(() => { store = new ToolDataStore(); seed(store); });

  it('inserts a booking carrying cab-route metadata', async () => {
    const result = await createCabBooking(store, { organizationId: ORG_A, contactId: CONTACT_A, packageSku: 'CAB-DEL-JAI-SEDAN', pickupDate: '2026-08-01', idempotencyKey: 'cab-1' });
    expect(result.status).toBe('confirmed');
    expect(result.totalAmount).toBe('₹3,500');
    expect(store.bookings.length).toBe(1);
    const meta = store.bookings[0]!.metadata as Record<string, unknown>;
    expect(meta.type).toBe('cab-route');
    expect(meta.fromCity).toBe('Delhi');
    expect(meta.toCity).toBe('Jaipur');
    expect(meta.vehicleClass).toBe('sedan');
    expect(meta.pickupDate).toBe('2026-08-01');
    expect(meta.fare).toBe(3500);
  });

  it('throws for unknown contact', async () => {
    await expect(createCabBooking(store, { organizationId: ORG_A, contactId: randomUUID(), packageSku: 'CAB-DEL-JAI-SEDAN', pickupDate: '2026-08-01', idempotencyKey: 'cab-x' })).rejects.toThrow('Contact not found');
  });
});

describe('createServiceBooking', () => {
  let store: ToolDataStore;
  beforeEach(() => { store = new ToolDataStore(); seed(store); });

  it('inserts a booking carrying home-service metadata', async () => {
    const result = await createServiceBooking(store, { organizationId: ORG_A, contactId: CONTACT_A, packageSku: 'SVC-COOK-MONTHLY', startDate: '2026-08-05', idempotencyKey: 'svc-1' });
    expect(result.status).toBe('confirmed');
    expect(result.totalAmount).toBe('₹6,000');
    expect(store.bookings.length).toBe(1);
    const meta = store.bookings[0]!.metadata as Record<string, unknown>;
    expect(meta.type).toBe('home-service');
    expect(meta.service).toBe('cooking');
    expect(meta.planType).toBe('monthly');
    expect(meta.area).toBe('HSR Layout');
    expect(meta.startDate).toBe('2026-08-05');
  });
});
