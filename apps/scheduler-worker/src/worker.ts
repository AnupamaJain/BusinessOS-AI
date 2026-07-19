import { logger } from '@business-os-ai/shared-types';
import type { ToolDataStore } from '@business-os-ai/mcp-business-tools';
import { randomUUID } from 'crypto';

export class SchedulerWorker {
  constructor(private store: ToolDataStore) {}

  /**
   * Polls and processes all due automation runs.
   * A run is due if its status is 'scheduled' and the scheduled time is in the past.
   */
  async processDueRuns(): Promise<{ processedCount: number; completedCount: number; failedCount: number; skippedCount: number }> {
    const now = new Date();
    const currentHour = now.getUTCHours();

    let processedCount = 0;
    let completedCount = 0;
    let failedCount = 0;
    let skippedCount = 0;

    // Filter due runs
    const dueRuns = this.store.automationRuns.filter((run) => {
      return run.status === 'scheduled' && new Date(run.scheduledFor) <= now;
    });

    for (const run of dueRuns) {
      processedCount++;

      // 1. Enforce allowed sending window (09:00 - 21:00 UTC)
      if (currentHour < 9 || currentHour >= 21) {
        logger.warn('Skipping run: Outside allowed sending window (09:00-21:00 UTC).', { runId: run.id, currentHour });
        skippedCount++;
        continue;
      }

      // 2. Validate current consent status (requires active marketing opt-in)
      const contact = this.store.contacts.find((c) => c.id === run.contactId && c.organizationId === run.organizationId);
      if (!contact) {
        run.status = 'failed';
        this.logAudit(run.organizationId, 'automation_failed', 'automation_run', run.id, { error: 'contact_not_found' });
        failedCount++;
        continue;
      }

      const marketingConsent = this.store.consentRecords.filter((c) => c.contactId === run.contactId && c.organizationId === run.organizationId && c.consentType === 'marketing');
      const latest = marketingConsent[marketingConsent.length - 1];

      // Opt-out check
      const optOuts = this.store.consentRecords.filter((c) => c.contactId === run.contactId && c.organizationId === run.organizationId && c.action === 'opt_out');
      const hasOptedOut = optOuts.length > 0 && (!latest || latest.action === 'opt_out' || optOuts.indexOf(optOuts[optOuts.length - 1]!) > marketingConsent.indexOf(latest));

      if (!latest || latest.action !== 'opt_in' || hasOptedOut) {
        logger.warn('Failing run: Consent revoked or missing.', { runId: run.id, contactId: run.contactId });
        run.status = 'failed';
        this.logAudit(run.organizationId, 'automation_failed', 'automation_run', run.id, { error: 'consent_revoked_or_missing' });
        failedCount++;
        continue;
      }

      // 3. Trigger WhatsApp Outbound template call (Simulated)
      try {
        // Simulate sending outbound message
        const outboundMsg = `[TEMPLATE: ${run.templateKey}] Hello! We are following up on your skincare request.`;
        this.store.messages.push({
          direction: 'outbound',
          content: outboundMsg,
          createdAt: now.toISOString(),
          organizationId: run.organizationId,
          conversationId: run.conversationId,
        });

        run.status = 'completed';
        this.logAudit(run.organizationId, 'automation_completed', 'automation_run', run.id, { templateKey: run.templateKey });
        completedCount++;
        
        logger.info('Automation campaign run executed successfully.', { runId: run.id, contactId: run.contactId });
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        run.status = 'failed';
        this.logAudit(run.organizationId, 'automation_failed', 'automation_run', run.id, { error: errorMsg });
        failedCount++;
      }
    }

    return { processedCount, completedCount, failedCount, skippedCount };
  }

  private logAudit(
    organizationId: string,
    action: string,
    entityType: string,
    entityId: string,
    details: Record<string, unknown>
  ): void {
    this.store.auditEvents.push({
      id: randomUUID(),
      organizationId,
      action,
      entityType,
      entityId,
      actorType: 'system',
      details,
      createdAt: new Date().toISOString(),
    });
  }
}
