import { describe, it, expect, beforeEach } from 'vitest';
import { LeadService, ContactService } from '../index';

const ORG_A = '11111111-1111-1111-1111-111111111111';

describe('CRM Package', () => {
  let leadService: LeadService;
  let contactService: ContactService;

  beforeEach(() => {
    leadService = new LeadService();
    contactService = new ContactService();
  });

  it('creates and manages contacts idempotently', () => {
    const c1 = contactService.getOrCreateContact({
      organizationId: ORG_A,
      phoneNumber: '+919876543210',
      name: 'Anupama'
    });
    expect(c1.id).toBeDefined();
    expect(c1.name).toBe('Anupama');

    const c2 = contactService.getOrCreateContact({
      organizationId: ORG_A,
      phoneNumber: '+919876543210',
      email: 'anupama@example.com'
    });

    expect(c2.id).toBe(c1.id);
    expect(c2.email).toBe('anupama@example.com');
  });

  it('upserts leads and calculates qualification stages', () => {
    const contact = contactService.getOrCreateContact({
      organizationId: ORG_A,
      phoneNumber: '+919876543210'
    });

    const res1 = leadService.upsertLead({
      organizationId: ORG_A,
      contactId: contact.id,
      serviceInterest: 'Bali Honeymoon Package',
      budgetRange: '₹1-2 Lakhs',
      score: 75,
      idempotencyKey: 'lead- Bali-1'
    });

    expect(res1.created).toBe(true);
    expect(res1.lead.stage).toBe('qualified');
    expect(res1.lead.serviceInterest).toBe('Bali Honeymoon Package');

    const res2 = leadService.upsertLead({
      organizationId: ORG_A,
      contactId: contact.id,
      serviceInterest: 'Bali Honeymoon Package',
      score: 75,
      idempotencyKey: 'lead- Bali-1'
    });

    expect(res2.created).toBe(false);
    expect(res2.lead.id).toBe(res1.lead.id);
  });
});
