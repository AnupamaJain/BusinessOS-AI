import { logger } from '@business-os-ai/shared-types';
import type { BusinessStore, AutomationRunRecord, ContactRecord } from '@business-os-ai/mcp-business-tools';
import { randomUUID } from 'crypto';

export interface TemplateSendResult {
  success: boolean;
  providerMessageId?: string;
  error?: string;
}

export type TemplateSender = (params: {
  run: AutomationRunRecord;
  contact: ContactRecord;
  content: string;
  templateKey: string;
}) => Promise<TemplateSendResult>;

export interface SchedulerWorkerOptions {
  /**
   * Real outbound dispatcher (WhatsApp template send via the gateway adapter).
   * When omitted (tests / dry-run) the message is persisted without dispatch.
   */
  sendTemplate?: TemplateSender;
  /** When true, evaluates eligibility but never dispatches. */
  dryRun?: boolean;
}

export class SchedulerWorker {
  constructor(private store: BusinessStore, private options: SchedulerWorkerOptions = {}) {}

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

    const dueRuns = await this.store.listDueAutomationRuns(now);

    for (const run of dueRuns) {
      processedCount++;

      // 1. Enforce allowed sending window (09:00 - 21:00 UTC)
      if (currentHour < 9 || currentHour >= 21) {
        logger.warn('Skipping run: Outside allowed sending window (09:00-21:00 UTC).', { runId: run.id, currentHour });
        skippedCount++;
        continue;
      }

      // 2. Validate current consent status (requires active marketing opt-in)
      const contact = await this.store.findContactById(run.organizationId, run.contactId);
      if (!contact) {
        await this.failRun(run, 'contact_not_found');
        failedCount++;
        continue;
      }

      const consent = await this.store.listConsent(run.organizationId, run.contactId);
      const marketingConsent = consent.filter((c) => c.consentType === 'marketing');
      const latest = marketingConsent[marketingConsent.length - 1];

      const optOuts = consent.filter((c) => c.action === 'opt_out');
      const hasOptedOut = optOuts.length > 0 &&
        (!latest || latest.action === 'opt_out' || consent.indexOf(optOuts[optOuts.length - 1]!) > consent.indexOf(latest));

      if (!latest || latest.action !== 'opt_in' || hasOptedOut) {
        logger.warn('Failing run: Consent revoked or missing.', { runId: run.id, contactId: run.contactId });
        await this.failRun(run, 'consent_revoked_or_missing');
        failedCount++;
        continue;
      }

      // 3. Dry-run mode: evaluate only
      if (this.options.dryRun) {
        logger.info('Dry-run: automation eligible, not dispatched.', { runId: run.id });
        skippedCount++;
        continue;
      }

      // 4. Render the approved template and dispatch
      try {
        const template = await this.store.findTemplate(run.organizationId, run.templateKey);
        const content = renderTemplate(template?.content, {
          name: contact.name ?? 'there',
          product: 'your enquiry',
        }) ?? `[TEMPLATE: ${run.templateKey}] Hello! We are following up on your enquiry.`;

        if (this.options.sendTemplate) {
          const result = await this.options.sendTemplate({ run, contact, content, templateKey: run.templateKey });
          if (!result.success) {
            await this.failRun(run, result.error ?? 'send_failed');
            failedCount++;
            continue;
          }
        }

        await this.store.insertMessage({
          direction: 'outbound',
          content,
          createdAt: now.toISOString(),
          organizationId: run.organizationId,
          conversationId: run.conversationId,
          messageType: 'template',
        });

        await this.store.updateAutomationRun(run.organizationId, run.id, { status: 'sent' });
        await this.logAudit(run.organizationId, 'automation_completed', 'automation_run', run.id, { templateKey: run.templateKey });
        completedCount++;

        logger.info('Automation campaign run executed successfully.', { runId: run.id, contactId: run.contactId });
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        await this.failRun(run, errorMsg);
        failedCount++;
      }
    }

    return { processedCount, completedCount, failedCount, skippedCount };
  }

  private async failRun(run: AutomationRunRecord, error: string): Promise<void> {
    await this.store.updateAutomationRun(run.organizationId, run.id, { status: 'failed' });
    await this.logAudit(run.organizationId, 'automation_failed', 'automation_run', run.id, { error });
  }

  private async logAudit(
    organizationId: string,
    action: string,
    entityType: string,
    entityId: string,
    details: Record<string, unknown>,
  ): Promise<void> {
    await this.store.insertAuditEvent({
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

function renderTemplate(content: string | undefined, params: Record<string, string>): string | undefined {
  if (!content) return undefined;
  return content.replace(/\{\{(\w+)\}\}/g, (_m, key: string) => params[key] ?? '');
}
