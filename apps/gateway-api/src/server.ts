import express from 'express';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { createApp, type InboundCallbackMessage } from './app';
import { MockWhatsAppAdapter } from './adapters/mock-whatsapp-adapter';
import { MetaCloudApiAdapter } from './adapters/meta-cloud-api-adapter';
import type { WhatsAppAdapter } from './adapters/types';
import { SupabaseIdempotencyService, SupabaseMessageService } from './services/supabase-services';
import { createServiceClient, type SupabaseClient } from '@business-os-ai/database';
import { SupabaseBusinessStore } from '@business-os-ai/mcp-business-tools';
import { createGatewayFromEnv, type LLMGateway } from '@business-os-ai/llm-gateway';
import {
  createEmbeddingProviderFromEnv, SupabaseVectorStore, executeAgentGraph,
  ingestMarkdownContent, type AgentGraphDeps, type EmbeddingProvider,
} from '@business-os-ai/agent-core';
import { verifySupabaseAccessToken, getOrganizationRole } from '@business-os-ai/auth';
import { RazorpayPaymentService } from '@business-os-ai/commerce';
import { SchedulerWorker } from '@business-os-ai/scheduler-worker';
import { logger } from '@business-os-ai/shared-types';
import { waitUntil } from '@vercel/functions';

/** Real-embedding similarity threshold for grounding decisions. */
const PROD_RETRIEVAL_THRESHOLD = 0.35;

export interface ServerContext {
  app: express.Express;
  adapter: WhatsAppAdapter;
  db: SupabaseClient;
  store: SupabaseBusinessStore;
  llm: LLMGateway;
  embedder: EmbeddingProvider | null;
}

/**
 * Production composition root. Wires:
 *   Meta webhook → durable dedup → Postgres persistence → agent graph
 *   (LLM + pgvector RAG + policy gates) → WhatsApp reply → Postgres.
 */
export function buildServer(env: Record<string, string | undefined> = process.env): ServerContext {
  const supabaseUrl = env['NEXT_PUBLIC_SUPABASE_URL'];
  const serviceKey = env['SUPABASE_SERVICE_ROLE_KEY'];
  const anonKey = env['NEXT_PUBLIC_SUPABASE_ANON_KEY'];
  if (!supabaseUrl || !serviceKey || !anonKey) {
    throw new Error('Missing Supabase configuration: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY are required.');
  }

  const defaultOrgId = env['DEFAULT_ORG_ID'] ?? '11111111-1111-1111-1111-111111111111';
  const verifyToken = env['META_VERIFY_TOKEN'] ?? 'test-verify-token';
  const internalApiKey = env['INTERNAL_API_KEY'];
  const cronSecret = env['CRON_SECRET'];

  const db = createServiceClient(supabaseUrl, serviceKey);
  const store = new SupabaseBusinessStore(db);

  // ── LLM gateway with per-tenant usage persisted to llm_usage ──
  const llm = createGatewayFromEnv(env, {
    allowMockFallback: true,
    usageSink: async (record) => {
      await db.from('llm_usage').insert({
        organization_id: record.organizationId,
        provider: record.provider,
        model: record.model,
        purpose: 'completion',
        prompt_tokens: record.promptTokens,
        completion_tokens: record.completionTokens,
        total_tokens: record.totalTokens,
        estimated_cost_usd: record.estimatedCostUsd,
        latency_ms: record.latencyMs,
      });
    },
  });

  const embedder = createEmbeddingProviderFromEnv(env);
  const vectorStore = new SupabaseVectorStore(db);

  // ── WhatsApp adapter selection ──
  const accessToken = env['META_WHATSAPP_ACCESS_TOKEN'];
  const phoneNumberId = env['META_WHATSAPP_PHONE_NUMBER_ID'];
  const mockRequested = env['ENABLE_MOCK_WHATSAPP'] === 'true';

  let adapter: WhatsAppAdapter;
  if (!mockRequested && accessToken && phoneNumberId) {
    logger.info('Meta WhatsApp Cloud API adapter active', { phoneNumberId });
    adapter = new MetaCloudApiAdapter({ accessToken, phoneNumberId, verifyToken });
  } else {
    if (!mockRequested) {
      logger.warn('META_WHATSAPP_ACCESS_TOKEN / META_WHATSAPP_PHONE_NUMBER_ID not set — WhatsApp sends will be recorded locally until Meta credentials are configured.');
    }
    adapter = new MockWhatsAppAdapter(verifyToken);
  }

  const idempotencyService = new SupabaseIdempotencyService(db);
  const messageService = new SupabaseMessageService(store);

  // Organization context cache (name/vertical for prompts)
  const orgCache = new Map<string, { name: string; vertical?: string }>();
  async function getOrgContext(orgId: string): Promise<{ name: string; vertical?: string }> {
    const cached = orgCache.get(orgId);
    if (cached) return cached;
    const { data } = await db.from('organizations').select('name, vertical, settings').eq('id', orgId).maybeSingle();
    const ctx = { name: data?.name ?? 'our business', vertical: data?.vertical ?? undefined };
    orgCache.set(orgId, ctx);
    return ctx;
  }

  function agentDeps(org: { name: string; vertical?: string }): AgentGraphDeps {
    return {
      llm,
      embedder: embedder ?? undefined,
      vectorStore: embedder ? vectorStore : undefined,
      retrievalThreshold: embedder ? PROD_RETRIEVAL_THRESHOLD : undefined,
      vertical: org.vertical,
      businessName: org.name,
    };
  }

  // ── Inbound message → agent graph → WhatsApp reply ──
  async function handleInbound(orgId: string, msg: InboundCallbackMessage): Promise<void> {
    if (!msg.text || !msg.contactId || !msg.conversationId) {
      logger.info('Skipping non-text inbound message', { providerMessageId: msg.providerMessageId, type: msg.type });
      return;
    }

    try {
      const org = await getOrgContext(orgId);
      const state = await executeAgentGraph(store, {
        organizationId: orgId,
        contactId: msg.contactId,
        conversationId: msg.conversationId,
        inboundMessage: msg.text,
        traceId: msg.providerMessageId,
      }, agentDeps(org));

      if (state.finalResponse) {
        const result = await adapter.sendMessage(orgId, {
          to: msg.from,
          type: 'text',
          text: state.finalResponse,
          idempotencyKey: `reply:${msg.providerMessageId}`,
        });
        if (result.success && result.providerMessageId) {
          await messageService.persistOutbound(orgId, msg.from, state.finalResponse, result.providerMessageId, msg.conversationId);
        } else if (!result.success) {
          logger.error('Failed to send agent reply', { error: result.error, to: msg.from });
        }
      }

      await idempotencyService.markProcessed(msg.providerMessageId, orgId);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error('Agent runtime error', { providerMessageId: msg.providerMessageId, error: errorMsg });
      await idempotencyService.markProcessed(msg.providerMessageId, orgId, errorMsg);
    }
  }

  // ── Auth helpers for internal/operator routes ──
  function isInternalAuthorised(req: express.Request): boolean {
    const key = req.headers['x-internal-key'];
    if (internalApiKey && key === internalApiKey) return true;
    const auth = req.headers.authorization;
    if (cronSecret && auth === `Bearer ${cronSecret}`) return true;
    return false;
  }

  async function authoriseOperator(req: express.Request): Promise<{ userId: string; organizationId: string; role: string } | null> {
    const auth = req.headers.authorization;
    if (!auth?.startsWith('Bearer ')) return null;
    const user = await verifySupabaseAccessToken({ supabaseUrl: supabaseUrl!, anonKey: anonKey!, accessToken: auth.slice(7) });
    if (!user) return null;
    const membership = await getOrganizationRole({ supabaseUrl: supabaseUrl!, serviceRoleKey: serviceKey!, userId: user.userId });
    if (!membership) return null;
    return { userId: user.userId, organizationId: membership.organizationId, role: membership.role };
  }

  // ── Payments (active once Razorpay credentials are configured) ──
  const razorpay = env['RAZORPAY_KEY_ID'] && env['RAZORPAY_KEY_SECRET']
    ? new RazorpayPaymentService({
        keyId: env['RAZORPAY_KEY_ID'],
        keySecret: env['RAZORPAY_KEY_SECRET'],
        webhookSecret: env['RAZORPAY_WEBHOOK_SECRET'],
        supabase: db,
      })
    : null;

  // ── Production routes ──
  const registerRoutes = (app: express.Express): void => {
    /** Razorpay payment webhook — signature-verified, updates payments/orders. */
    app.post('/webhooks/razorpay', async (req, res) => {
      if (!razorpay) {
        res.status(503).json({ error: 'Razorpay not configured (set RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET).' });
        return;
      }
      const signature = req.headers['x-razorpay-signature'];
      const rawBody = (req as express.Request & { rawBody?: Buffer }).rawBody;
      if (!rawBody || typeof signature !== 'string' || !razorpay.verifyWebhookSignature(rawBody, signature)) {
        logger.warn('Razorpay webhook rejected: invalid signature');
        res.status(401).json({ error: 'Invalid signature' });
        return;
      }
      try {
        const result = await razorpay.handleWebhookEvent(req.body);
        res.status(200).json(result);
      } catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
      }
    });
    const OperatorMessageSchema = z.object({
      conversationId: z.string().uuid(),
      text: z.string().min(1).max(4096),
    });

    /** Operator sends a WhatsApp reply from the dashboard. */
    app.post('/api/operator/messages', async (req, res) => {
      const operator = await authoriseOperator(req);
      if (!operator) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }
      const parsed = OperatorMessageSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ success: false, error: 'Invalid request', details: parsed.error.issues });
        return;
      }

      const conversation = await store.getConversation(operator.organizationId, parsed.data.conversationId);
      if (!conversation?.contactId) {
        res.status(404).json({ success: false, error: 'Conversation not found' });
        return;
      }
      const contact = await store.findContactById(operator.organizationId, conversation.contactId);
      if (!contact) {
        res.status(404).json({ success: false, error: 'Contact not found' });
        return;
      }

      const result = await adapter.sendMessage(operator.organizationId, {
        to: contact.phone,
        type: 'text',
        text: parsed.data.text,
        idempotencyKey: `operator:${randomUUID()}`,
      });

      if (result.success && result.providerMessageId) {
        await messageService.persistOutbound(operator.organizationId, contact.phone, parsed.data.text, result.providerMessageId, conversation.id);
        await store.insertAuditEvent({
          id: randomUUID(),
          organizationId: operator.organizationId,
          action: 'operator_message_sent',
          entityType: 'message',
          entityId: '',
          actorType: 'user',
          details: { conversationId: conversation.id, userId: operator.userId },
          createdAt: new Date().toISOString(),
        });
        res.status(200).json({ success: true, providerMessageId: result.providerMessageId });
      } else {
        res.status(502).json({ success: false, error: result.error ?? 'Send failed' });
      }
    });

    /** Ingest knowledge-base documents with real embeddings into pgvector. */
    const IngestSchema = z.object({
      organizationId: z.string().uuid().optional(),
      documents: z.array(z.object({
        title: z.string().min(1),
        sourcePath: z.string().min(1),
        content: z.string().min(1),
      })).min(1),
    });

    app.post('/internal/rag/ingest', async (req, res) => {
      if (!isInternalAuthorised(req)) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      if (!embedder) {
        res.status(503).json({ error: 'No embedding provider configured (set AI_GATEWAY_API_KEY, OPENAI_API_KEY, or deploy on Vercel with OIDC).' });
        return;
      }
      const parsed = IngestSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid request', details: parsed.error.issues });
        return;
      }
      try {
        const result = await ingestMarkdownContent(
          parsed.data.organizationId ?? defaultOrgId,
          parsed.data.documents,
          embedder,
          vectorStore,
        );
        res.status(200).json(result);
      } catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
      }
    });

    /** Scheduler tick — invoked by Vercel Cron or manually. */
    const runScheduler = async (_req: express.Request, res: express.Response): Promise<void> => {
      const worker = new SchedulerWorker(store, {
        dryRun: env['ENABLE_DRY_RUN_AUTOMATION'] === 'true',
        sendTemplate: async ({ run, contact, content }) => {
          return adapter.sendMessage(run.organizationId, {
            to: contact.phone,
            type: 'text',
            text: content,
            idempotencyKey: `automation:${run.id}`,
          });
        },
      });
      const result = await worker.processDueRuns();
      res.status(200).json(result);
    };

    app.get('/internal/scheduler/run', async (req, res) => {
      if (!isInternalAuthorised(req)) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      await runScheduler(req, res);
    });
    app.post('/internal/scheduler/run', async (req, res) => {
      if (!isInternalAuthorised(req)) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      await runScheduler(req, res);
    });

    /** Live diagnostics: verifies LLM + embedding connectivity end-to-end. */
    app.get('/internal/llm/health', async (req, res) => {
      if (!isInternalAuthorised(req)) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      const report: Record<string, unknown> = {
        providers: llm.realProviderNames,
        embeddingConfigured: !!embedder,
      };
      try {
        const completion = await llm.generateCompletion({
          organizationId: defaultOrgId,
          maxTokens: 20,
          messages: [{ role: 'user', content: 'Reply with the single word: pong' }],
        });
        report['completion'] = { ok: true, provider: completion.provider, model: completion.model, content: completion.content.slice(0, 50) };
      } catch (err) {
        report['completion'] = { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
      if (embedder) {
        try {
          const vec = await embedder.getEmbedding('ping');
          report['embedding'] = { ok: true, dimensions: vec.length };
        } catch (err) {
          report['embedding'] = { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      }
      res.status(200).json(report);
    });
  };

  const app = createApp({
    adapter,
    idempotencyService,
    messageService,
    defaultOrgId,
    appSecret: env['META_APP_SECRET'] || undefined,
    corsOrigins: (env['CORS_ORIGINS'] ?? '*').split(',').map((s) => s.trim()),
    onInboundMessage: handleInbound,
    registerRoutes,
    backgroundTask: (work) => {
      try {
        waitUntil(work);
      } catch {
        void work;
      }
    },
    // Vercel provides the OIDC token via request header; surface it for the
    // AI Gateway providers which read process.env at call time.
    preMiddleware: (req, _res, next) => {
      const oidc = req.headers['x-vercel-oidc-token'];
      if (typeof oidc === 'string' && oidc.length > 0) {
        process.env['VERCEL_OIDC_TOKEN'] = oidc;
      }
      next();
    },
  });

  return { app, adapter, db, store, llm, embedder };
}
