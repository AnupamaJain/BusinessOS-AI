import { describe, it, expect, beforeEach } from 'vitest';
import { ToolDataStore } from '../tools';

const ORG = 'org-1';

describe('Business Brain contact notes', () => {
  let store: ToolDataStore;
  let contactId: string;

  beforeEach(async () => {
    store = new ToolDataStore();
    const contact = await store.upsertContactByPhone(ORG, '+918770507368', 'Asha');
    contactId = contact.id;
  });

  it('round-trips notes and returns them newest first', async () => {
    await store.addContactNote(ORG, { contactId, kind: 'note', body: 'First note' });
    await store.addContactNote(ORG, { contactId, kind: 'memory', body: 'Prefers evening calls' });
    await store.addContactNote(ORG, { contactId, kind: 'note', body: 'Third note' });

    const notes = await store.getContactNotes(ORG, contactId);
    expect(notes).toHaveLength(3);
    // Newest first
    expect(notes.map((n) => n.body)).toEqual(['Third note', 'Prefers evening calls', 'First note']);
    expect(notes[0]).toMatchObject({ contactId, kind: 'note', body: 'Third note' });
    expect(notes[1]).toMatchObject({ kind: 'memory', body: 'Prefers evening calls' });
    expect(typeof notes[0]!.id).toBe('string');
    expect(typeof notes[0]!.createdAt).toBe('string');
  });

  it('dedups an identical memory body but allows a different one', async () => {
    await store.addContactNote(ORG, { contactId, kind: 'memory', body: 'Allergic to nuts' });
    await store.addContactNote(ORG, { contactId, kind: 'memory', body: 'Allergic to nuts' });

    let memories = (await store.getContactNotes(ORG, contactId)).filter((n) => n.kind === 'memory');
    expect(memories).toHaveLength(1);

    await store.addContactNote(ORG, { contactId, kind: 'memory', body: 'Allergic to shellfish' });
    memories = (await store.getContactNotes(ORG, contactId)).filter((n) => n.kind === 'memory');
    expect(memories).toHaveLength(2);
  });

  it('does not dedup notes with the same body (only memories)', async () => {
    await store.addContactNote(ORG, { contactId, kind: 'note', body: 'Called customer' });
    await store.addContactNote(ORG, { contactId, kind: 'note', body: 'Called customer' });
    const notes = await store.getContactNotes(ORG, contactId);
    expect(notes).toHaveLength(2);
  });

  it('scopes notes by organization and contact', async () => {
    await store.addContactNote(ORG, { contactId, kind: 'note', body: 'Mine' });
    expect(await store.getContactNotes('other-org', contactId)).toHaveLength(0);
    expect(await store.getContactNotes(ORG, 'other-contact')).toHaveLength(0);
  });

  it('updateContactLastSeen is callable and stamps the contact', async () => {
    await expect(store.updateContactLastSeen(ORG, contactId)).resolves.toBeUndefined();
    const contact = await store.findContactById(ORG, contactId);
    expect(contact?.lastSeenAt).toBeDefined();
    expect(typeof contact?.lastSeenAt).toBe('string');
  });
});
