import type { Contact } from './types';
import { randomUUID } from 'crypto';

export class ContactService {
  private contactsStore: Contact[] = [];

  public getOrCreateContact(params: {
    organizationId: string;
    phoneNumber: string;
    name?: string;
    email?: string;
  }): Contact {
    const existing = this.contactsStore.find(
      c => c.organizationId === params.organizationId && c.phoneNumber === params.phoneNumber
    );

    if (existing) {
      if (params.name && !existing.name) existing.name = params.name;
      if (params.email && !existing.email) existing.email = params.email;
      existing.updatedAt = new Date().toISOString();
      return existing;
    }

    const newContact: Contact = {
      id: randomUUID(),
      organizationId: params.organizationId,
      phoneNumber: params.phoneNumber,
      name: params.name,
      email: params.email,
      metadata: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    this.contactsStore.push(newContact);
    return newContact;
  }

  public getContactsByOrganization(organizationId: string): Contact[] {
    return this.contactsStore.filter(c => c.organizationId === organizationId);
  }
}
