import * as path from 'path';
import { logger } from '@business-os-ai/shared-types';
import { createServiceClient } from '@business-os-ai/database';
import { SupabaseBusinessStore } from '@business-os-ai/mcp-business-tools';
import { SchedulerWorker } from './worker';

export { SchedulerWorker } from './worker';
export type { SchedulerWorkerOptions, TemplateSender, TemplateSendResult } from './worker';

/**
 * Standalone polling entrypoint (Docker / local).
 * In the Vercel deployment the same logic runs via the gateway's
 * /internal/scheduler/run endpoint on a cron schedule.
 */
if (require.main === module) {
  try {
    process.loadEnvFile(path.resolve(__dirname, '../../../.env'));
  } catch {
    // rely on process environment
  }

  const supabaseUrl = process.env['NEXT_PUBLIC_SUPABASE_URL'];
  const serviceKey = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  const gatewayUrl = process.env['GATEWAY_INTERNAL_URL'] ?? 'http://localhost:3001';
  const internalKey = process.env['INTERNAL_API_KEY'];
  const intervalMs = parseInt(process.env['SCHEDULER_INTERVAL_MS'] ?? '60000', 10);

  if (!supabaseUrl || !serviceKey) {
    logger.error('Scheduler worker requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }

  const db = createServiceClient(supabaseUrl, serviceKey);
  const store = new SupabaseBusinessStore(db);
  const worker = new SchedulerWorker(store, {
    dryRun: process.env['ENABLE_DRY_RUN_AUTOMATION'] === 'true',
    sendTemplate: async ({ run, contact, content }) => {
      // Dispatch through the gateway so adapter selection & persistence stay centralised.
      const response = await fetch(`${gatewayUrl}/internal/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(internalKey ? { 'x-internal-key': internalKey } : {}),
        },
        body: JSON.stringify({
          organizationId: run.organizationId,
          to: contact.phone,
          type: 'text',
          text: content,
          idempotencyKey: `automation:${run.id}`,
        }),
      });
      if (!response.ok) {
        return { success: false, error: `Gateway send failed: HTTP ${response.status}` };
      }
      const result = (await response.json()) as { success: boolean; providerMessageId?: string; error?: string };
      return result;
    },
  });

  logger.info('Scheduler worker started', { intervalMs });
  const tick = async (): Promise<void> => {
    try {
      const result = await worker.processDueRuns();
      if (result.processedCount > 0) {
        logger.info('Scheduler tick complete', { ...result });
      }
    } catch (err) {
      logger.error('Scheduler tick failed', { error: err instanceof Error ? err.message : String(err) });
    }
  };
  void tick();
  setInterval(() => { void tick(); }, intervalMs);
}
