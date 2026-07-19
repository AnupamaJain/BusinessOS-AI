import { describe, it, expect, beforeEach, vi } from 'vitest';
import { randomUUID } from 'crypto';
import { ToolDataStore } from '@whatsapp-smb/mcp-business-tools';
import { SchedulerWorker } from '../worker';

const ORG_A = '11111111-1111-1111-1111-111111111111';
const CONTACT_A = randomUUID();
const CONV_A = randomUUID();

function seedStore(store: ToolDataStore) {
  store.contacts.push({ id: CONTACT_A, organizationId: ORG_A, phone: '+919876543210', name: 'Priya' });
  store.conversations.push({ id: CONV_A, organizationId: ORG_A, status: 'active' });
  store.consentRecords.push({ contactId: CONTACT_A, organizationId: ORG_A, consentType: 'marketing', action: 'opt_in' });
}

describe('Scheduler Worker', () => {
  let store: ToolDataStore;
  let worker: SchedulerWorker;

  beforeEach(() => {
    store = new ToolDataStore();
    seedStore(store);
    worker = new SchedulerWorker(store);
  });

  it('processes a due run successfully when consent and window are valid', async () => {
    // Set system time to 12:00 UTC (inside allowed sending window)
    const mockDate = new Date('2026-07-19T12:00:00Z');
    vi.useFakeTimers();
    vi.setSystemTime(mockDate);

    // Queue a run scheduled 1 hour ago
    const scheduledFor = new Date(mockDate.getTime() - 3600 * 1000);
    store.automationRuns.push({
      id: 'run-001',
      organizationId: ORG_A,
      contactId: CONTACT_A,
      conversationId: CONV_A,
      templateKey: 'qualified_lead_24h_followup',
      campaignType: 'qualified_lead_followup',
      idempotencyKey: 'idemp-001',
      status: 'scheduled',
      scheduledFor: scheduledFor.toISOString(),
    });

    const result = await worker.processDueRuns();
    expect(result.processedCount).toBe(1);
    expect(result.completedCount).toBe(1);
    expect(store.automationRuns[0]?.status).toBe('completed');
    expect(store.messages.length).toBe(1);
    expect(store.messages[0]?.direction).toBe('outbound');
    expect(store.auditEvents.some((e) => e.action === 'automation_completed')).toBe(true);

    vi.useRealTimers();
  });

  it('fails the run if user has revoked marketing consent', async () => {
    const mockDate = new Date('2026-07-19T12:00:00Z');
    vi.useFakeTimers();
    vi.setSystemTime(mockDate);

    // Add opt-out record
    store.consentRecords.push({ contactId: CONTACT_A, organizationId: ORG_A, consentType: 'marketing', action: 'opt_out' });

    const scheduledFor = new Date(mockDate.getTime() - 3600 * 1000);
    store.automationRuns.push({
      id: 'run-002',
      organizationId: ORG_A,
      contactId: CONTACT_A,
      conversationId: CONV_A,
      templateKey: 'qualified_lead_24h_followup',
      campaignType: 'qualified_lead_followup',
      idempotencyKey: 'idemp-002',
      status: 'scheduled',
      scheduledFor: scheduledFor.toISOString(),
    });

    const result = await worker.processDueRuns();
    expect(result.completedCount).toBe(0);
    expect(result.failedCount).toBe(1);
    expect(store.automationRuns[0]?.status).toBe('failed');
    expect(store.auditEvents.some((e) => e.action === 'automation_failed')).toBe(true);

    vi.useRealTimers();
  });

  it('skips (does not fail) the run if outside allowed sending window (09:00 - 21:00 UTC)', async () => {
    // Set system time to 3:00 AM UTC (outside sending window)
    const mockDate = new Date('2026-07-19T03:00:00Z');
    vi.useFakeTimers();
    vi.setSystemTime(mockDate);

    const scheduledFor = new Date(mockDate.getTime() - 3600 * 1000);
    store.automationRuns.push({
      id: 'run-003',
      organizationId: ORG_A,
      contactId: CONTACT_A,
      conversationId: CONV_A,
      templateKey: 'qualified_lead_24h_followup',
      campaignType: 'qualified_lead_followup',
      idempotencyKey: 'idemp-003',
      status: 'scheduled',
      scheduledFor: scheduledFor.toISOString(),
    });

    const result = await worker.processDueRuns();
    expect(result.processedCount).toBe(1);
    expect(result.skippedCount).toBe(1);
    expect(result.completedCount).toBe(0);
    expect(store.automationRuns[0]?.status).toBe('scheduled'); // Remains scheduled for later retry

    vi.useRealTimers();
  });
});
