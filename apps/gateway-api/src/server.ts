import express from 'express';
import QRCode from 'qrcode';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { createApp, type InboundCallbackMessage } from './app';
import { MockWhatsAppAdapter } from './adapters/mock-whatsapp-adapter';
import { MetaCloudApiAdapter } from './adapters/meta-cloud-api-adapter';
import { TwilioWhatsAppAdapter } from './adapters/twilio-whatsapp-adapter';
import { InstagramMessengerAdapter } from './adapters/instagram-adapter';
import type { WhatsAppAdapter, InboundMessage, InteractiveList, ReplyButton } from './adapters/types';
import type { AgentState } from '@business-os-ai/agent-core';
import { SupabaseIdempotencyService, SupabaseMessageService } from './services/supabase-services';
import { createServiceClient, type SupabaseClient } from '@business-os-ai/database';
import { SupabaseBusinessStore, createCabBooking as createCabBookingTool, createServiceBooking as createServiceBookingTool } from '@business-os-ai/mcp-business-tools';
import { createGatewayFromEnv, type LLMGateway } from '@business-os-ai/llm-gateway';
import {
  createEmbeddingProviderFromEnv, SupabaseVectorStore, executeAgentGraph,
  ingestMarkdownContent, runOwnerAssistant, isOwnerConfirmation, planItinerary,
  type AgentGraphDeps, type EmbeddingProvider,
} from '@business-os-ai/agent-core';
import { verifySupabaseAccessToken, getOrganizationRole } from '@business-os-ai/auth';
import { RazorpayPaymentService, buildQuotationHtml, buildInvoiceHtml } from '@business-os-ai/commerce';
import {
  createEmailServiceFromEnv, createOcrServiceFromEnv, buildQuotationEmail,
  createBillingServiceFromEnv, PLANS, createHubSpotServiceFromEnv, HubSpotService,
  createTranscriptionServiceFromEnv, createTtsServiceFromEnv,
  createSheetsServiceFromEnv, parseSpreadsheetId,
} from '@business-os-ai/integrations';
import { SchedulerWorker } from '@business-os-ai/scheduler-worker';
import { logger } from '@business-os-ai/shared-types';
import { waitUntil } from '@vercel/functions';
import {
  normalizeFilter, computeStats, engagementScore, personalize,
  wrapEmailLinks, verifyTrack, type SegmentFilter,
} from './marketing';

/** Real-embedding similarity threshold for grounding decisions. */
const PROD_RETRIEVAL_THRESHOLD = 0.35;

/** Coarse per-instance rate-limit windows keyed by client IP. */
const rateWindows = new Map<string, { count: number; reset: number }>();

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + '…';
}

/**
 * Promotes an agent reply to a rich interactive message when the conversation
 * warrants it — a tappable list of the real catalogue results the agent found,
 * or quick-action buttons on an opening/unclear message.
 */
function buildInteractive(state: AgentState): { list?: InteractiveList; buttons?: ReplyButton[] } {
  for (const tc of [...state.toolCalls].reverse()) {
    const out = tc.output as Record<string, unknown> | undefined;
    // Agent-driven choice picker (dates, time slots, quick actions) takes priority.
    if (tc.tool === 'offer_choices' && out) {
      if (out['list']) return { list: out['list'] as InteractiveList };
      if (out['buttons']) return { buttons: out['buttons'] as ReplyButton[] };
    }
    if (tc.tool === 'search_travel_packages') {
      const pkgs = (out?.['packages'] as Array<{ sku: string; title: string; pricePerPerson: string; durationDays: number }> | undefined) ?? [];
      if (pkgs.length >= 2) {
        return { list: {
          header: 'Our holiday packages',
          button: 'View packages',
          items: pkgs.slice(0, 10).map((p) => ({ id: p.sku, title: truncate(p.title, 24), description: truncate(`${p.pricePerPerson} · ${p.durationDays} days`, 72) })),
        } };
      }
    }
    if (tc.tool === 'search_product_catalog') {
      const prods = (out?.['products'] as Array<{ sku: string; name: string; price: string }> | undefined) ?? [];
      if (prods.length >= 2) {
        return { list: {
          header: 'Our products',
          button: 'View products',
          items: prods.slice(0, 10).map((p) => ({ id: p.sku, title: truncate(p.name, 24), description: truncate(p.price, 72) })),
        } };
      }
    }
    if (tc.tool === 'search_cab_routes') {
      const routes = (out?.['routes'] as Array<{ sku: string; title: string; fare: string; vehicleClass: string; estimatedHours: number }> | undefined) ?? [];
      if (routes.length >= 2) {
        return { list: {
          header: 'Available cabs',
          button: 'View routes',
          items: routes.slice(0, 10).map((r) => ({ id: r.sku, title: truncate(r.title, 24), description: truncate(`${r.fare} · ${r.vehicleClass} · ~${r.estimatedHours}h`, 72) })),
        } };
      }
    }
    if (tc.tool === 'search_service_plans') {
      const plans = (out?.['plans'] as Array<{ sku: string; title: string; price: string; planType: string }> | undefined) ?? [];
      if (plans.length >= 2) {
        return { list: {
          header: 'Our plans',
          button: 'View plans',
          items: plans.slice(0, 10).map((p) => ({ id: p.sku, title: truncate(p.title, 24), description: truncate(`${p.price} · ${p.planType}`, 72) })),
        } };
      }
    }
  }
  // Opening / unclear message → quick-action buttons
  if (!state.handoffId && !state.policyDecision?.shouldHandoff && state.intent === 'unknown') {
    return { buttons: [{ id: 'browse-offers', title: '🧳 Browse offers' }, { id: 'talk-human', title: '💬 Talk to a human' }] };
  }
  return {};
}

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
  const store = new SupabaseBusinessStore(db, env['ENCRYPTION_KEY']);

  /**
   * Tenant-scoped data access. Every query is automatically filtered (reads /
   * updates / deletes) or stamped (inserts) with organization_id, so business
   * logic never passes it by hand — removing the "forgot the org_id filter"
   * class of cross-tenant bug on the service-role path. Composite (organization_id, id)
   * foreign keys enforce the same boundary at the storage layer. Use for
   * org-scoped tables (not `organizations`, which is keyed by id).
   */
  function tenantDb(orgId: string) {
    return {
      from(table: string) {
        // The service client has no Database generic, so a dynamic table name is
        // loosely typed — same as the raw db.from() calls this replaces. The
        // returned builders stay chainable (.eq/.in/.order/.maybeSingle/…).
        /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
        const t = db.from(table) as any;
        return {
          select: (cols = '*') => t.select(cols).eq('organization_id', orgId),
          insert: (row: Record<string, unknown> | Record<string, unknown>[]) =>
            t.insert(Array.isArray(row) ? row.map((r) => ({ ...r, organization_id: orgId })) : { ...row, organization_id: orgId }),
          update: (patch: Record<string, unknown>) => t.update(patch).eq('organization_id', orgId),
          delete: () => t.delete().eq('organization_id', orgId),
        };
      },
    };
  }

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

  // ── WhatsApp adapter selection (Twilio → Meta → Mock) ──
  const accessToken = env['META_WHATSAPP_ACCESS_TOKEN'];
  const phoneNumberId = env['META_WHATSAPP_PHONE_NUMBER_ID'];
  const mockRequested = env['ENABLE_MOCK_WHATSAPP'] === 'true';

  const twilioSid = env['TWILIO_ACCOUNT_SID'];
  const twilioToken = env['TWILIO_AUTH_TOKEN'];
  const twilioNumber = env['TWILIO_WHATSAPP_NUMBER'];
  const twilioAdapter = (twilioSid && twilioToken && twilioNumber)
    ? new TwilioWhatsAppAdapter({ accountSid: twilioSid, authToken: twilioToken, fromNumber: twilioNumber })
    : null;

  // Optional explicit override: WHATSAPP_PROVIDER = meta | twilio | mock
  const providerOverride = (env['WHATSAPP_PROVIDER'] ?? '').toLowerCase();
  const canMeta = !!(accessToken && phoneNumberId);
  const canTwilio = !!twilioAdapter;
  const choice = mockRequested ? 'mock'
    : providerOverride === 'meta' && canMeta ? 'meta'
    : providerOverride === 'twilio' && canTwilio ? 'twilio'
    : providerOverride === 'mock' ? 'mock'
    : canMeta ? 'meta'          // default preference: Meta (native interactive UI)
    : canTwilio ? 'twilio'
    : 'mock';

  // Build every configured adapter — the platform runs Meta and Twilio
  // simultaneously, replying to each inbound message on the channel it arrived on.
  const metaAdapter = canMeta ? new MetaCloudApiAdapter({ accessToken: accessToken!, phoneNumberId: phoneNumberId!, verifyToken }) : null;

  let adapter: WhatsAppAdapter;   // primary — used for /webhook (Meta) verification, /internal/messages, scheduler
  let activeProvider: 'twilio' | 'meta' | 'mock';
  if (choice === 'meta') {
    logger.info('Primary WhatsApp adapter: Meta Cloud API', { phoneNumberId, twilioAlsoActive: canTwilio });
    adapter = metaAdapter!;
    activeProvider = 'meta';
  } else if (choice === 'twilio') {
    logger.info('Primary WhatsApp adapter: Twilio', { fromNumber: twilioNumber, metaAlsoActive: canMeta });
    adapter = twilioAdapter!;
    activeProvider = 'twilio';
  } else {
    if (!mockRequested) {
      logger.warn('No WhatsApp provider credentials set (Meta or Twilio) — sends recorded locally until configured.');
    }
    adapter = new MockWhatsAppAdapter(verifyToken);
    activeProvider = 'mock';
  }

  // ── Instagram Direct / Messenger channel (optional) ──
  // Same agent pipeline, different Meta surface. Enabled when a Page/IG token is set.
  const igPageId = env['INSTAGRAM_PAGE_ID'];
  const igPageToken = env['INSTAGRAM_PAGE_ACCESS_TOKEN'];
  const instagramAdapter = (igPageId && igPageToken)
    ? new InstagramMessengerAdapter({
        pageId: igPageId,
        pageAccessToken: igPageToken,
        verifyToken: env['INSTAGRAM_VERIFY_TOKEN'] ?? verifyToken,
        channel: (env['INSTAGRAM_CHANNEL'] as 'instagram' | 'messenger') ?? 'instagram',
      })
    : null;
  if (instagramAdapter) logger.info('Instagram/Messenger channel active', { pageId: igPageId });

  const idempotencyService = new SupabaseIdempotencyService(db);
  const messageService = new SupabaseMessageService(store);

  // ── Multi-tenant: per-org Meta adapters resolved by phone_number_id ──
  const orgAdapterCache = new Map<string, { organizationId: string; replyAdapter: WhatsAppAdapter }>();
  async function resolveInbound(msg: InboundMessage): Promise<{ organizationId: string; replyAdapter: WhatsAppAdapter } | null> {
    const phoneId = (msg.metadata as Record<string, unknown> | undefined)?.['phoneNumberId'] as string | undefined;
    if (!phoneId) return null;
    // The platform's own configured number keeps using the primary adapter/default org.
    if (phoneNumberId && phoneId === phoneNumberId) return { organizationId: defaultOrgId, replyAdapter: adapter };
    const cached = orgAdapterCache.get(phoneId);
    if (cached) return cached;
    const conn = await store.getWhatsAppConnectionByPhoneId(phoneId);
    if (!conn) return null;
    const resolved = {
      organizationId: conn.organizationId,
      replyAdapter: new MetaCloudApiAdapter({ accessToken: conn.accessToken, phoneNumberId: conn.phoneNumberId, verifyToken }) as WhatsAppAdapter,
    };
    orgAdapterCache.set(phoneId, resolved);
    return resolved;
  }

  /** The correct outbound adapter for an org — its own connected number if any, else the primary. */
  async function adapterForOrg(orgId: string): Promise<WhatsAppAdapter> {
    if (orgId === defaultOrgId) return adapter;
    const { data } = await tenantDb(orgId).from('whatsapp_connections').select('phone_number_id').eq('status', 'active').maybeSingle();
    const phoneId = data?.phone_number_id as string | undefined;
    if (!phoneId) return adapter;
    const cached = orgAdapterCache.get(phoneId);
    if (cached) return cached.replyAdapter;
    const conn = await store.getWhatsAppConnectionByPhoneId(phoneId);
    if (!conn) return adapter;
    const a = new MetaCloudApiAdapter({ accessToken: conn.accessToken, phoneNumberId: conn.phoneNumberId, verifyToken }) as WhatsAppAdapter;
    orgAdapterCache.set(phoneId, { organizationId: orgId, replyAdapter: a });
    return a;
  }

  /** True when the org has blown its monthly LLM budget (falls back to deterministic replies). */
  const costCapUsd = parseFloat(env['LLM_MONTHLY_COST_CAP_USD'] ?? '0');
  async function isOverCostCap(orgId: string): Promise<boolean> {
    if (!costCapUsd || costCapUsd <= 0) return false;
    try {
      const { data } = await db.rpc('org_llm_spend_this_month', { p_org: orgId });
      return typeof data === 'number' && data >= costCapUsd;
    } catch {
      return false;
    }
  }

  const alertEmail = env['ALERT_EMAIL'];

  /**
   * Fire an ops alert email, de-duplicated across instances: only one email is
   * sent per (key, hour) window even if every serverless instance trips it.
   */
  async function alertOps(key: string, subject: string, body: string): Promise<void> {
    if (!alertEmail || !emailService.isConfigured) return;
    const windowKey = new Date().toISOString().slice(0, 13); // hourly bucket
    try {
      const { data: claimed } = await db.rpc('claim_alert', { p_key: key, p_window_key: windowKey });
      if (claimed !== true) return; // another instance already alerted this window
      await emailService.send({
        to: alertEmail,
        subject: `🚨 SaarthiOne alert: ${subject}`,
        html: `<h3>${subject}</h3><pre style="white-space:pre-wrap;font-family:monospace;font-size:13px">${body.slice(0, 4000).replace(/</g, '&lt;')}</pre><p style="color:#888">Throttled to one email per hour per alert key.</p>`,
      });
    } catch { /* alerting is best-effort */ }
  }

  /** Persist an error to the durable sink; alert on high-severity sources. */
  async function recordError(source: string, message: string, ctx?: Record<string, unknown>, orgId?: string, severity: 'warn' | 'error' | 'critical' = 'error'): Promise<void> {
    try {
      await db.from('error_events').insert({ organization_id: orgId ?? null, source, severity, message: message.slice(0, 2000), context: ctx ?? {} });
    } catch { /* never let logging break the request */ }
    // Page a human for the failure classes that mean "the product is down".
    if (severity === 'critical' || source === 'agent_runtime' || source === 'whatsapp_send' || source === 'token_expired') {
      await alertOps(`${source}:${orgId ?? 'platform'}`, `${source} (${orgId ?? 'platform'})`, `${message}\n\ncontext: ${JSON.stringify(ctx ?? {}, null, 2)}`);
    }
  }

  /**
   * Per-write audit trail for privileged / service-role operations — records who
   * (actor) did what (action/operation) to which resource, org-scoped. Best-effort;
   * never lets auditing break a request.
   */
  async function audit(orgId: string | null, action: string, opts?: { actor?: string; resource?: string; resourceId?: string; operation?: 'insert' | 'update' | 'delete'; details?: Record<string, unknown> }): Promise<void> {
    try {
      await db.from('service_audit_log').insert({
        organization_id: orgId, actor: opts?.actor ?? 'system', action,
        resource: opts?.resource ?? null, resource_id: opts?.resourceId ?? null,
        operation: opts?.operation ?? null, details: opts?.details ?? {},
      });
    } catch { /* auditing is best-effort */ }
  }

  // Organization context cache (name/vertical/rules/team for prompts)
  type OrgContext = { name: string; vertical?: string; businessRules?: Record<string, unknown>; enabledAgents?: string[]; onboardingStatus?: string };
  const orgCache = new Map<string, OrgContext>();
  async function getOrgContext(orgId: string): Promise<OrgContext> {
    const cached = orgCache.get(orgId);
    if (cached) return cached;
    const { data } = await db.from('organizations').select('name, vertical, settings, business_rules, enabled_agents, onboarding_status').eq('id', orgId).maybeSingle();
    const rules = (data?.business_rules && typeof data.business_rules === 'object') ? data.business_rules as Record<string, unknown> : {};
    const ctx: OrgContext = {
      name: data?.name ?? 'our business',
      vertical: data?.vertical ?? undefined,
      businessRules: Object.keys(rules).length ? rules : undefined,
      enabledAgents: Array.isArray(data?.enabled_agents) ? (data!.enabled_agents as string[]) : undefined,
      onboardingStatus: (data?.onboarding_status as string | undefined) ?? 'active',
    };
    orgCache.set(orgId, ctx);
    return ctx;
  }

  const publicBaseUrl = (env['PUBLIC_GATEWAY_URL'] ?? 'https://saarthione-api.vercel.app').replace(/\/$/, '');
  const emailService = createEmailServiceFromEnv(env);
  const ocrService = createOcrServiceFromEnv(env);
  const transcriptionService = createTranscriptionServiceFromEnv(env);
  const ttsService = createTtsServiceFromEnv(env);
  const billing = createBillingServiceFromEnv(env);
  const hubspot = createHubSpotServiceFromEnv(env); // platform env fallback (default org)
  // One platform Google service account signs for every tenant; each merchant
  // shares their own spreadsheet with its email (see createSheetsServiceFromEnv).
  const sheets = createSheetsServiceFromEnv(env);

  // Each merchant connects their OWN HubSpot (integration_connections); resolve
  // per-org, falling back to the platform env token.
  const hubspotCache = new Map<string, HubSpotService | null>();
  async function hubspotForOrg(orgId: string): Promise<HubSpotService | null> {
    const cached = hubspotCache.get(orgId);
    if (cached !== undefined) return cached;
    let svc: HubSpotService | null = null;
    try {
      const conn = await store.getIntegrationConnection(orgId, 'hubspot');
      if (conn?.status === 'active' && conn.config['accessToken']) {
        svc = new HubSpotService({ accessToken: String(conn.config['accessToken']), webhookSecret: conn.config['webhookSecret'] ? String(conn.config['webhookSecret']) : undefined });
      }
    } catch { /* fall through to env */ }
    if (!svc && hubspot.isConfigured) svc = hubspot;
    hubspotCache.set(orgId, svc);
    return svc;
  }

  /**
   * Outbound CRM sync: mirror a qualified lead into the org's HubSpot as a
   * contact + deal. Best-effort and non-blocking (called via waitUntil).
   */
  async function syncLeadToHubSpot(orgId: string, leadId: string): Promise<void> {
    const hubspot = await hubspotForOrg(orgId);
    if (!hubspot) return;
    try {
      const { data: lead } = await tenantDb(orgId).from('leads')
        .select('id, contact_id, service_interest, score, stage, estimated_value, hubspot_deal_id')
        .eq('id', leadId).maybeSingle();
      if (!lead?.contact_id) return;
      const { data: contact } = await tenantDb(orgId).from('contacts')
        .select('id, name, email, phone_number, hubspot_contact_id')
        .eq('id', lead.contact_id).maybeSingle();
      if (!contact) return;
      // Real (decrypted) phone — the column may be masked at rest.
      const realPhone = (await store.findContactById(orgId, contact.id))?.phone ?? undefined;
      if (!realPhone) return;

      const [firstName, ...rest] = (contact.name ?? '').trim().split(/\s+/);
      const c = await hubspot.upsertContact({
        phone: realPhone,
        email: contact.email ?? undefined,
        firstName: firstName || undefined,
        lastName: rest.join(' ') || undefined,
        lifecycleStage: (lead.score ?? 0) >= 50 ? 'salesqualifiedlead' : 'lead',
      });
      if (c.ok && c.id && c.id !== contact.hubspot_contact_id) {
        await db.from('contacts').update({ hubspot_contact_id: c.id }).eq('id', contact.id);
      }

      const d = await hubspot.upsertDeal({
        dealName: `${contact.name ?? realPhone} — ${lead.service_interest ?? 'enquiry'}`.slice(0, 120),
        amount: typeof lead.estimated_value === 'number' ? lead.estimated_value : undefined,
        stage: (lead.stage as string) === 'qualified' ? 'qualifiedtobuy' : 'appointmentscheduled',
        contactId: c.id,
        externalId: `saarthi-lead-${lead.id}`,
      });
      if (d.ok && d.id && d.id !== lead.hubspot_deal_id) {
        await db.from('leads').update({ hubspot_deal_id: d.id }).eq('id', lead.id);
      }
      logger.info('Lead synced to HubSpot', { orgId, leadId, contactId: c.id, dealId: d.id });
    } catch (err) {
      logger.warn('HubSpot lead sync failed', { orgId, leadId, error: err instanceof Error ? err.message : String(err) });
    }
  }

  // ── Google Sheets (lightweight CRM / data source) ──
  // Auth is platform-level (`sheets`); per-tenant we store only the spreadsheet
  // id + tab prefs in integration_connections. Cache mirrors hubspotCache and is
  // invalidated on connect/disconnect.
  interface SheetConfig {
    spreadsheetId: string;
    leadsTab: string;
    contactsTab: string;
    reportsTab: string;
    syncLeads: boolean;
  }
  const sheetConfigCache = new Map<string, SheetConfig | null>();
  async function sheetConfigForOrg(orgId: string): Promise<SheetConfig | null> {
    const cached = sheetConfigCache.get(orgId);
    if (cached !== undefined) return cached;
    let cfg: SheetConfig | null = null;
    try {
      const conn = await store.getIntegrationConnection(orgId, 'google_sheets');
      if (conn?.status === 'active' && conn.config['spreadsheetId']) {
        cfg = {
          spreadsheetId: String(conn.config['spreadsheetId']),
          leadsTab: String(conn.config['leadsTab'] ?? 'Leads'),
          contactsTab: String(conn.config['contactsTab'] ?? 'Contacts'),
          reportsTab: String(conn.config['reportsTab'] ?? 'Reports'),
          syncLeads: conn.config['syncLeads'] !== false,
        };
      }
    } catch { /* treat as not connected */ }
    sheetConfigCache.set(orgId, cfg);
    return cfg;
  }

  /**
   * Use case 1 — Lead collection: append a newly qualified lead as a row to the
   * merchant's Sheet. Best-effort, non-blocking (called via waitUntil).
   */
  async function appendLeadToSheet(orgId: string, leadId: string): Promise<void> {
    if (!sheets.isConfigured) return;
    const cfg = await sheetConfigForOrg(orgId);
    if (!cfg || !cfg.syncLeads) return;
    try {
      const { data: lead } = await tenantDb(orgId).from('leads')
        .select('id, contact_id, service_interest, score, stage, created_at')
        .eq('id', leadId).maybeSingle();
      if (!lead?.contact_id) return;
      const { data: contact } = await tenantDb(orgId).from('contacts')
        .select('id, name, email').eq('id', lead.contact_id).maybeSingle();
      const realPhone = (await store.findContactById(orgId, lead.contact_id))?.phone ?? '';
      await sheets.ensureHeader(cfg.spreadsheetId, cfg.leadsTab,
        ['Date', 'Name', 'Phone', 'Email', 'Interest', 'Score', 'Stage']);
      await sheets.appendRows(cfg.spreadsheetId, cfg.leadsTab, [[
        new Date(String(lead.created_at ?? new Date().toISOString())).toISOString(),
        contact?.name ?? '',
        realPhone,
        contact?.email ?? '',
        String(lead.service_interest ?? ''),
        String(lead.score ?? ''),
        String(lead.stage ?? ''),
      ]]);
      await audit(orgId, 'sheets.lead_append', { actor: 'agent', resource: 'google_sheets', resourceId: cfg.spreadsheetId, operation: 'insert', details: { leadId } });
      logger.info('Lead appended to Google Sheet', { orgId, leadId });
    } catch (err) {
      logger.warn('Sheet lead append failed', { orgId, leadId, error: err instanceof Error ? err.message : String(err) });
    }
  }

  // ── Data-driven marketing: campaigns, segmentation, tracking ──────
  // HMAC secret for stateless tracked-link tokens (/r/:token).
  const trackSecret = env['ENCRYPTION_KEY'] || env['INTERNAL_API_KEY'] || 'saarthi-track';

  interface AudienceMember { contactId: string; name: string; phone: string; email: string }

  /** Resolve a segment filter into a de-duplicated list of reachable contacts. */
  async function resolveAudience(orgId: string, filter: SegmentFilter, channel: 'whatsapp' | 'email'): Promise<AudienceMember[]> {
    let q = tenantDb(orgId).from('leads')
      .select('contact_id, stage, score, service_interest, updated_at, contacts(name, email, phone_number, phone_enc)');
    if (filter.stages?.length) q = q.in('stage', filter.stages);
    if (filter.minScore) q = q.gte('score', filter.minScore);
    if (filter.serviceInterest) q = q.ilike('service_interest', `%${filter.serviceInterest}%`);
    if (filter.recencyDays) q = q.gte('updated_at', new Date(Date.now() - filter.recencyDays * 86_400_000).toISOString());
    const { data } = await q.limit(3000);

    const seen = new Map<string, { name: string; email: string }>();
    for (const row of (data ?? []) as Array<{ contact_id?: string; contacts?: { name?: string; email?: string } | { name?: string; email?: string }[] }>) {
      const cid = row.contact_id;
      if (!cid || seen.has(cid)) continue;
      const c = Array.isArray(row.contacts) ? row.contacts[0] : row.contacts;
      seen.set(cid, { name: c?.name ?? '', email: c?.email ?? '' });
    }

    const out: AudienceMember[] = [];
    for (const [contactId, c] of seen) {
      if (channel === 'email') {
        if (!c.email) continue;
        out.push({ contactId, name: c.name, phone: '', email: c.email });
      } else {
        const phone = (await store.findContactById(orgId, contactId))?.phone ?? '';
        if (!phone) continue;
        out.push({ contactId, name: c.name, phone, email: c.email });
      }
    }
    return out;
  }

  interface CampaignRow {
    id: string; channel: 'whatsapp' | 'email'; template_key: string | null;
    email_subject: string | null; email_html: string | null; target_url: string | null;
    sent_at: string | null;
  }

  /** Execute a campaign: create recipient rows, send per channel, record outcomes. */
  async function runCampaign(orgId: string, campaign: CampaignRow, audience: AudienceMember[]): Promise<void> {
    const nowIso = () => new Date().toISOString();
    const byContact = new Map(audience.map((a) => [a.contactId, a]));
    const rows = audience.map((a) => ({
      campaign_id: campaign.id, contact_id: a.contactId, channel: campaign.channel,
      address: campaign.channel === 'email' ? a.email : a.phone, status: 'queued',
    }));
    const { data: inserted } = await tenantDb(orgId).from('campaign_recipients')
      .insert(rows).select('id, contact_id, address');
    const recipients = (inserted ?? []) as Array<{ id: string; contact_id: string; address: string }>;
    await tenantDb(orgId).from('campaigns').update({ total: recipients.length, sent_at: campaign.sent_at ?? nowIso() }).eq('id', campaign.id);

    let sent = 0, failed = 0;
    const adapter = campaign.channel === 'whatsapp' ? await adapterForOrg(orgId) : null;

    for (const r of recipients) {
      const a = byContact.get(r.contact_id);
      try {
        if (campaign.channel === 'whatsapp' && adapter) {
          const sr = await adapter.sendMessage(orgId, {
            to: r.address, type: 'template', templateKey: campaign.template_key ?? 'hello_world',
            templateParams: { name: a?.name || 'there' }, text: `Hi ${a?.name || 'there'}!`,
            idempotencyKey: `campaign:${campaign.id}:${r.address}`,
          });
          if (sr.success) { sent++; await tenantDb(orgId).from('campaign_recipients').update({ status: 'sent', provider_message_id: sr.providerMessageId ?? null, updated_at: nowIso() }).eq('id', r.id); }
          else { failed++; await tenantDb(orgId).from('campaign_recipients').update({ status: 'failed', error: sr.error ?? 'send failed', updated_at: nowIso() }).eq('id', r.id); }
        } else {
          // Email: personalize, then route every link through /r/ for CTR.
          const vars = { name: a?.name || 'there', url: campaign.target_url ?? '' };
          let html = personalize(campaign.email_html ?? '', vars);
          html = wrapEmailLinks(html, publicBaseUrl, trackSecret, campaign.id, r.id);
          const er = await emailService.send({ to: r.address, subject: personalize(campaign.email_subject ?? '', vars), html });
          if (er.sent) { sent++; await tenantDb(orgId).from('campaign_recipients').update({ status: 'sent', provider_message_id: er.id ?? null, updated_at: nowIso() }).eq('id', r.id); }
          else { failed++; await tenantDb(orgId).from('campaign_recipients').update({ status: 'failed', error: er.error ?? 'send failed', updated_at: nowIso() }).eq('id', r.id); }
        }
      } catch (err) {
        failed++;
        await tenantDb(orgId).from('campaign_recipients').update({ status: 'failed', error: err instanceof Error ? err.message : String(err), updated_at: nowIso() }).eq('id', r.id);
      }
    }
    await tenantDb(orgId).from('campaigns').update({
      status: sent === 0 && failed > 0 ? 'failed' : 'sent', sent, failed, completed_at: nowIso(),
    }).eq('id', campaign.id);
    logger.info('Campaign sent', { orgId, campaignId: campaign.id, sent, failed });
  }

  /** Attribute a new lead to the contact's most recent campaign touch (last 30d). */
  async function attributeConversion(orgId: string, contactId: string): Promise<void> {
    try {
      const cutoff = new Date(Date.now() - 30 * 86_400_000).toISOString();
      const { data } = await tenantDb(orgId).from('campaign_recipients')
        .select('id').eq('contact_id', contactId).is('converted_at', null).gte('created_at', cutoff)
        .order('created_at', { ascending: false }).limit(1);
      const id = (data as Array<{ id: string }> | null)?.[0]?.id;
      if (!id) return;
      await tenantDb(orgId).from('campaign_recipients').update({ converted_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', id);
    } catch { /* attribution is best-effort */ }
  }

  /** Delivery-status webhook handler (WhatsApp sent/delivered/read) → recipients. */
  async function applyStatusEvents(events: Array<{ providerMessageId: string; status: string }>): Promise<void> {
    const nowIso = new Date().toISOString();
    for (const e of events) {
      try {
        if (e.status === 'read') {
          await db.from('campaign_recipients').update({ status: 'read', opened_at: nowIso, updated_at: nowIso }).eq('provider_message_id', e.providerMessageId);
        } else if (e.status === 'delivered') {
          await db.from('campaign_recipients').update({ status: 'delivered', delivered_at: nowIso, updated_at: nowIso }).eq('provider_message_id', e.providerMessageId).in('status', ['sent', 'queued']);
        } else if (e.status === 'failed') {
          await db.from('campaign_recipients').update({ status: 'failed', error: 'delivery failed', updated_at: nowIso }).eq('provider_message_id', e.providerMessageId).in('status', ['sent', 'queued', 'delivered']);
        }
      } catch { /* best-effort */ }
    }
  }

  function agentDeps(orgId: string, org: OrgContext): AgentGraphDeps {
    return {
      llm,
      embedder: embedder ?? undefined,
      vectorStore: embedder ? vectorStore : undefined,
      retrievalThreshold: embedder ? PROD_RETRIEVAL_THRESHOLD : undefined,
      vertical: org.vertical,
      businessName: org.name,
      businessRules: org.businessRules as AgentGraphDeps['businessRules'],
      enabledAgents: org.enabledAgents,
      createQuotation: async ({ contactId, packageSku, pricePerPerson, travellers }) => {
        try {
          const { data: pkg } = await tenantDb(orgId).from('packages').select('id').eq('sku', packageSku).maybeSingle();
          const amount = pricePerPerson * travellers;
          const number = `QT-${Math.floor(100000 + Math.random() * 900000)}`;
          const validUntil = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
          const { data, error } = await tenantDb(orgId).from('quotes').insert({
            contact_id: contactId, package_id: pkg?.id ?? null,
            quote_number: number, amount, valid_until: validUntil, status: 'sent',
          }).select('id').single();
          if (error || !data) return null;
          const url = `${publicBaseUrl}/doc/quote/${data.id}`;

          // Generate + attach an AI day-by-day itinerary to the quote (off the reply path).
          const itin = generateItineraryForQuote(orgId, data.id, packageSku, travellers, amount);
          try { waitUntil(itin); } catch { void itin; }

          // Email the quotation too, when the customer has an email on file.
          try {
            const { data: contact } = await db.from('contacts').select('name, email').eq('id', contactId).maybeSingle();
            if (contact?.email && emailService.isConfigured) {
              const mail = buildQuotationEmail({
                businessName: org.name, customerName: contact.name ?? undefined,
                quotationNumber: number, viewUrl: url, amountText: `₹${amount.toLocaleString('en-IN')}`,
              });
              const sent = await emailService.send({ to: contact.email, subject: mail.subject, html: mail.html });
              if (sent.sent) logger.info('Quotation email sent', { to: contact.email, number });
            }
          } catch (err) {
            logger.warn('Quotation email failed', { error: err instanceof Error ? err.message : String(err) });
          }

          return { url, number };
        } catch {
          return null;
        }
      },
      createCheckoutLink: async ({ contactId, packageSku, title, amount, travellers }) => {
        // Reserve the booking, then generate a real Razorpay payment link (if configured).
        const amountText = `₹${amount.toLocaleString('en-IN')}`;
        try {
          const booking = await store.insertBooking({ organizationId: orgId, contactId, packageSku, travelDate: new Date().toISOString(), travelerCount: travellers, totalAmount: amount });
          const orgRazorpay = await razorpayForOrg(orgId);
          if (!orgRazorpay) {
            // No gateway → fall back to the merchant's own UPI VPA if set.
            const upi = await upiPageForBooking(orgId, booking.id);
            if (upi) return { url: upi, amountText };
            logger.info('Booking reserved; no payment method connected — link deferred to team', { booking: booking.bookingNumber });
            return null;
          }
          // findContactById returns the REAL phone (decrypted) even though the
          // phone_number column may be masked at rest.
          const contact = await store.findContactById(orgId, contactId);
          const link = await orgRazorpay.createPaymentLink({
            organizationId: orgId, orderId: booking.id, amount, currency: 'INR',
            description: `${title} — ${travellers} traveller(s)`,
            customerName: contact?.name ?? undefined, customerPhone: contact?.phone ?? undefined,
            expiresInMinutes: 60,
          });
          return { url: link.url, amountText };
        } catch (err) {
          logger.warn('createCheckoutLink failed', { error: err instanceof Error ? err.message : String(err) });
          return null;
        }
      },
      // ── Intercity cab booking → reserve + Razorpay link ──
      createCabBooking: async ({ contactId, packageSku, pickupDate }) => {
        try {
          const res = await createCabBookingTool(store, { organizationId: orgId, contactId, packageSku, pickupDate, idempotencyKey: `cab:${contactId}:${packageSku}:${pickupDate}` });
          const amount = Number(String(res.totalAmount).replace(/[^\d.]/g, '')) || 0;
          const amountText = `₹${amount.toLocaleString('en-IN')}`;
          const orgRazorpay = await razorpayForOrg(orgId);
          if (!orgRazorpay || amount <= 0) {
            const upi = amount > 0 ? await upiPageForBooking(orgId, res.bookingId) : null;
            return upi ? { url: upi, amountText, bookingNumber: res.bookingNumber } : { amountText, bookingNumber: res.bookingNumber };
          }
          const contact = await store.findContactById(orgId, contactId);
          const link = await orgRazorpay.createPaymentLink({
            organizationId: orgId, orderId: res.bookingId, amount, currency: 'INR',
            description: `Cab booking ${res.bookingNumber}`,
            customerName: contact?.name ?? undefined, customerPhone: contact?.phone ?? undefined, expiresInMinutes: 180,
          });
          return { url: link.url, amountText, bookingNumber: res.bookingNumber };
        } catch (err) {
          logger.warn('createCabBooking failed', { error: err instanceof Error ? err.message : String(err) });
          return null;
        }
      },
      // ── Home-service booking → reserve + Razorpay link ──
      createServiceBooking: async ({ contactId, packageSku, startDate }) => {
        try {
          const res = await createServiceBookingTool(store, { organizationId: orgId, contactId, packageSku, startDate, idempotencyKey: `svc:${contactId}:${packageSku}:${startDate}` });
          const amount = Number(String(res.totalAmount).replace(/[^\d.]/g, '')) || 0;
          const amountText = `₹${amount.toLocaleString('en-IN')}`;
          const orgRazorpay = await razorpayForOrg(orgId);
          if (!orgRazorpay || amount <= 0) {
            const upi = amount > 0 ? await upiPageForBooking(orgId, res.bookingId) : null;
            return upi ? { url: upi, amountText, bookingNumber: res.bookingNumber } : { amountText, bookingNumber: res.bookingNumber };
          }
          const contact = await store.findContactById(orgId, contactId);
          const link = await orgRazorpay.createPaymentLink({
            organizationId: orgId, orderId: res.bookingId, amount, currency: 'INR',
            description: `Home service ${res.bookingNumber}`,
            customerName: contact?.name ?? undefined, customerPhone: contact?.phone ?? undefined, expiresInMinutes: 1440,
          });
          return { url: link.url, amountText, bookingNumber: res.bookingNumber };
        } catch (err) {
          logger.warn('createServiceBooking failed', { error: err instanceof Error ? err.message : String(err) });
          return null;
        }
      },
    };
  }

  // ── Inbound message → agent graph → WhatsApp reply ──
  // replyAdapter is the channel the message arrived on, so Meta and Twilio
  // conversations each get answered on their own channel.
  // Downloads a WhatsApp media file (Meta) and returns base64 + mime type.
  async function downloadMetaMedia(mediaId: string): Promise<{ base64: string; mime: string } | null> {
    if (!accessToken) return null;
    try {
      const metaRes = await fetch(`https://graph.facebook.com/v21.0/${mediaId}`, { headers: { Authorization: `Bearer ${accessToken}` } });
      if (!metaRes.ok) return null;
      const meta = (await metaRes.json()) as { url?: string; mime_type?: string };
      if (!meta.url) return null;
      const bin = await fetch(meta.url, { headers: { Authorization: `Bearer ${accessToken}` } });
      if (!bin.ok) return null;
      const buf = Buffer.from(await bin.arrayBuffer());
      return { base64: buf.toString('base64'), mime: meta.mime_type ?? 'image/jpeg' };
    } catch {
      return null;
    }
  }

  async function handleInbound(orgId: string, msg: InboundCallbackMessage, replyAdapter: WhatsAppAdapter = adapter): Promise<void> {
    if (!msg.contactId || !msg.conversationId) {
      logger.info('Skipping message without contact/conversation', { providerMessageId: msg.providerMessageId });
      return;
    }

    let wasVoiceNote = false; // reply in kind (voice) when the customer sent a voice note
    // Business Brain: stamp "last seen" for this customer (best-effort).
    try { await store.updateContactLastSeen(orgId, msg.contactId); } catch { /* non-critical */ }

    // ── Document / OCR extraction: customer sent an image or document ──
    if ((msg.type === 'image' || msg.type === 'document') && ocrService.isConfigured) {
      try {
        const meta = (msg.metadata ?? {}) as Record<string, unknown>;
        let image: { imageBase64?: string; mimeType?: string } | null = null;
        if (meta['channel'] === 'meta' && typeof meta['mediaId'] === 'string') {
          const dl = await downloadMetaMedia(meta['mediaId']);
          if (dl) image = { imageBase64: dl.base64, mimeType: dl.mime };
        }
        // If the customer has a booking awaiting payment, treat an image as a
        // payment screenshot: read the amount/ref and flag it for the merchant.
        const pendingForReceipt = image ? await latestPendingBookingForContact(orgId, msg.contactId) : null;
        if (image && pendingForReceipt) {
          const receipt = await ocrService.extractPaymentReceipt(image);
          const d = (receipt.ok && receipt.data) ? receipt.data : {};
          const amount = d['amount'] ?? '';
          const ref = d['reference'] ?? '';
          const summary = `Payment screenshot for ${pendingForReceipt.bookingNumber}${amount ? ` — ₹${String(amount).replace(/[^\d.,]/g, '')}` : ''}${ref ? ` · ref ${ref}` : ''}${d['date'] ? ` · ${d['date']}` : ''}`;
          try {
            await store.addContactNote(orgId, { contactId: msg.contactId, kind: 'note', body: `${summary} — verify & mark paid.` });
            await store.insertAuditEvent({ id: randomUUID(), organizationId: orgId, action: 'payment_receipt_uploaded', entityType: 'booking', entityId: pendingForReceipt.id, actorType: 'agent', details: { fields: d, providerMessageId: msg.providerMessageId }, createdAt: new Date().toISOString() });
          } catch { /* note/audit best-effort */ }
          // Nudge the merchant (owner numbers) to verify.
          try {
            const owners = await store.getOwnerPhoneNumbers(orgId);
            const cust = await store.findContactById(orgId, msg.contactId);
            const orgAdapter = await adapterForOrg(orgId);
            for (const owner of owners.slice(0, 5)) {
              const confirmHint = cust?.name ? `Confirm ${cust.name}` : 'Paid';
              const notify = `💰 ${cust?.name ?? 'A customer'} sent a payment screenshot for ${pendingForReceipt.bookingNumber}${amount ? ` (₹${String(amount).replace(/[^\d.,]/g, '')})` : ''}${ref ? `, ref ${ref}` : ''}. Reply “${confirmHint}”, or mark it paid in your dashboard.`;
              await orgAdapter.sendMessage(orgId, { to: owner, type: 'text', text: notify, idempotencyKey: `receiptnotify:${msg.providerMessageId}:${owner}` });
            }
          } catch { /* notify best-effort */ }
          const reply = `🙏 Thanks! We’ve received your payment details${amount ? ` (₹${String(amount).replace(/[^\d.,]/g, '')})` : ''} and will confirm your booking shortly.`;
          const r = await replyAdapter.sendMessage(orgId, { to: msg.from, type: 'text', text: reply, idempotencyKey: `receipt:${msg.providerMessageId}` });
          if (r.success && r.providerMessageId) await messageService.persistOutbound(orgId, msg.from, reply, r.providerMessageId, msg.conversationId);
          await idempotencyService.markProcessed(msg.providerMessageId, orgId);
          return;
        }
        if (image) {
          const result = await ocrService.extractPassport(image);
          let reply: string;
          if (result.ok && result.data) {
            const d = result.data;
            const fields = [
              d['full_name'] && `• Name: ${d['full_name']}`,
              d['passport_number'] && `• Passport: ${d['passport_number']}`,
              d['nationality'] && `• Nationality: ${d['nationality']}`,
              d['date_of_birth'] && `• DOB: ${d['date_of_birth']}`,
              d['expiry_date'] && `• Expiry: ${d['expiry_date']}`,
            ].filter(Boolean);
            reply = fields.length > 0
              ? `📄 Thanks! I read your document:\n${fields.join('\n')}\n\nIs this correct? I'll attach it to your booking for visa processing.`
              : `📄 I received your document but couldn't read all the details clearly. Could you resend a clearer photo, or our team can help.`;
            await store.insertAuditEvent({ id: randomUUID(), organizationId: orgId, action: 'document_extracted', entityType: 'contact', entityId: msg.contactId, actorType: 'agent', details: { fields: d, providerMessageId: msg.providerMessageId }, createdAt: new Date().toISOString() });
          } else {
            reply = '📄 I received your document — our team will review it shortly.';
          }
          const r = await replyAdapter.sendMessage(orgId, { to: msg.from, type: 'text', text: reply, idempotencyKey: `ocr:${msg.providerMessageId}` });
          if (r.success && r.providerMessageId) await messageService.persistOutbound(orgId, msg.from, reply, r.providerMessageId, msg.conversationId);
        }
      } catch (err) {
        logger.error('OCR handling failed', { error: err instanceof Error ? err.message : String(err) });
      }
      await idempotencyService.markProcessed(msg.providerMessageId, orgId);
      return;
    }

    // ── Voice notes: transcribe to text, then answer like any message ──
    if (msg.type === 'audio' && transcriptionService.isConfigured) {
      const meta = (msg.metadata ?? {}) as Record<string, unknown>;
      let transcript = '';
      try {
        if (meta['channel'] === 'meta' && typeof meta['mediaId'] === 'string') {
          const dl = await downloadMetaMedia(meta['mediaId']);
          if (dl) {
            const r = await transcriptionService.transcribe({ audioBase64: dl.base64, mimeType: dl.mime });
            if (r.ok && r.text) transcript = r.text.trim();
          }
        }
      } catch (err) {
        logger.warn('Voice transcription failed', { error: err instanceof Error ? err.message : String(err) });
      }
      if (transcript) {
        logger.info('Voice note transcribed', { providerMessageId: msg.providerMessageId, chars: transcript.length });
        // Treat the transcript as the customer's message and continue to the agent
        // (mutate in place so earlier contact/conversation narrowing is preserved).
        msg.text = transcript;
        msg.type = 'text';
        wasVoiceNote = true;
      } else {
        const reply = '🎙️ Sorry, I couldn’t quite catch that voice note. Could you send it again, or type your message?';
        const r = await replyAdapter.sendMessage(orgId, { to: msg.from, type: 'text', text: reply, idempotencyKey: `voice:${msg.providerMessageId}` });
        if (r.success && r.providerMessageId) await messageService.persistOutbound(orgId, msg.from, reply, r.providerMessageId, msg.conversationId);
        await idempotencyService.markProcessed(msg.providerMessageId, orgId);
        return;
      }
    }

    if (!msg.text) {
      logger.info('Skipping non-text inbound message', { providerMessageId: msg.providerMessageId, type: msg.type });
      await idempotencyService.markProcessed(msg.providerMessageId, orgId);
      return;
    }

    try {
      const org = await getOrgContext(orgId);

      // Suspended merchants don't get AI processing — the account is inactive.
      if (org.onboardingStatus === 'suspended') {
        logger.info('Skipping message for suspended org', { orgId, providerMessageId: msg.providerMessageId });
        await idempotencyService.markProcessed(msg.providerMessageId, orgId);
        return;
      }

      // ── Owner assistant: does this message come from the business owner? ──
      // Owner mode triggers when the sender is a registered owner number, or
      // (for demo from a shared number) when the message starts with "owner"/"boss".
      const ownerNumbers = await store.getOwnerPhoneNumbers(orgId);
      const fromNorm = msg.from.startsWith('+') ? msg.from : `+${msg.from}`;
      const ownerKeyword = /^\s*(owner|boss|\/owner)\b[:,]?\s*/i;
      const keywordHit = ownerKeyword.test(msg.text);
      if (ownerNumbers.includes(fromNorm) || keywordHit) {
        const ownerQuestion = msg.text.replace(ownerKeyword, '').trim() || 'Give me today’s business summary.';
        const summary = await store.getBusinessSummary(orgId, new Date());

        let reply: string;
        // Merchant marks a UPI/manual payment as received: "Paid", "Confirm Rahul".
        const confirmNameMatch = ownerQuestion.match(/\bconfirm(?:ed)?\s+([a-z][\w.'-]*(?:\s+[a-z][\w.'-]*)?)/i);
        const wantsPayConfirm = /\b(paid|payment\s*(?:done|received|complete)|mark(?:ed)?\s*paid|received\s*(?:the\s*)?payment)\b/i.test(ownerQuestion) || !!confirmNameMatch;
        const payBookingNo = wantsPayConfirm ? await confirmLatestPendingBooking(orgId, confirmNameMatch?.[1]?.trim() ?? null) : null;
        if (payBookingNo) {
          reply = `✅ Marked ${payBookingNo} as paid and sent the customer their confirmation. 🎉`;
        // If the owner confirms a follow-up ("yes"/"follow up"), actually reach the cold leads.
        } else if (isOwnerConfirmation(ownerQuestion) && summary.staleContacts.length > 0) {
          let sent = 0;
          const today = new Date().toISOString().slice(0, 10);
          // Cold leads are outside the 24h window → business-initiated requires an
          // approved template. Route via the org's own connected number.
          const orgAdapter = await adapterForOrg(orgId);
          const templateKey = env['REENGAGEMENT_TEMPLATE'] ?? 'hello_world';
          for (const c of summary.staleContacts.slice(0, 10)) {
            if (!c.phone) continue;
            const re = `Hi ${c.name ?? 'there'}! 👋 Just checking in on your ${c.serviceInterest} enquiry — still interested?`;
            const r = await orgAdapter.sendMessage(orgId, {
              to: c.phone, type: 'template', templateKey,
              templateParams: { name: c.name ?? 'there' },
              text: re, idempotencyKey: `reengage:${c.contactId}:${today}`,
            });
            if (r.success) {
              sent++;
              if (r.providerMessageId) await messageService.persistOutbound(orgId, c.phone, re, r.providerMessageId);
            }
          }
          reply = sent > 0
            ? `✅ Done — I followed up with ${sent} customer${sent === 1 ? '' : 's'} who’d gone quiet. I’ll let you know as they reply.`
            : `I tried, but couldn’t reach the cold leads right now (they may need a template outside the 24-hour window). I’ll retry via the scheduler.`;
        } else {
          reply = await runOwnerAssistant({ llm, organizationId: orgId, businessName: org.name, message: ownerQuestion, summary });
        }

        const result = await replyAdapter.sendMessage(orgId, {
          to: msg.from, type: 'text', text: reply, idempotencyKey: `owner:${msg.providerMessageId}`,
        });
        if (result.success && result.providerMessageId) {
          await messageService.persistOutbound(orgId, msg.from, reply, result.providerMessageId, msg.conversationId);
        }
        await idempotencyService.markProcessed(msg.providerMessageId, orgId);
        return;
      }
      // Cost cap: if the tenant is over its monthly LLM budget, drop to the
      // deterministic (no-LLM) policy engine instead of billing more tokens.
      const deps = agentDeps(orgId, org);
      if (await isOverCostCap(orgId)) {
        deps.llm = undefined;
        await recordError('cost_cap', `LLM monthly cap reached; using deterministic replies`, {}, orgId);
      }
      const state = await executeAgentGraph(store, {
        organizationId: orgId,
        contactId: msg.contactId,
        conversationId: msg.conversationId,
        inboundMessage: msg.text,
        traceId: msg.providerMessageId,
      }, deps);

      if (state.finalResponse) {
        const rich = buildInteractive(state);
        const isRich = !!(rich.list || rich.buttons);
        let result = await replyAdapter.sendMessage(orgId, {
          to: msg.from,
          type: isRich ? 'interactive' : 'text',
          text: state.finalResponse,
          list: rich.list,
          buttons: rich.buttons,
          idempotencyKey: `reply:${msg.providerMessageId}`,
        });

        // Resilience: never leave the customer with silence. If a rich/interactive
        // send fails, retry the same answer as plain text.
        if (!result.success && isRich) {
          logger.warn('Interactive reply failed, retrying as plain text', { error: result.error, to: msg.from });
          result = await replyAdapter.sendMessage(orgId, {
            to: msg.from,
            type: 'text',
            text: state.finalResponse,
            idempotencyKey: `reply-txt:${msg.providerMessageId}`,
          });
        }

        if (result.success && result.providerMessageId) {
          await messageService.persistOutbound(orgId, msg.from, state.finalResponse, result.providerMessageId, msg.conversationId);
        } else if (!result.success) {
          logger.error('Failed to send agent reply', { error: result.error, to: msg.from });
          const errStr = result.error ?? 'send failed';
          // Meta 190 / 131005 = expired or invalid access token — page a human,
          // the tenant's number is effectively offline until it's refreshed.
          const isTokenExpiry = /\b190\b|131005|expired|OAuthException|access token/i.test(errStr);
          await recordError(isTokenExpiry ? 'token_expired' : 'whatsapp_send', errStr, { to: msg.from }, orgId, isTokenExpiry ? 'critical' : 'error');
        }

        // Reply in kind: the customer sent a voice note, so also send a spoken
        // reply (Google Cloud TTS → OGG/Opus → WhatsApp voice note). Best-effort,
        // off the reply path; the text answer above always goes out regardless.
        if (wasVoiceNote && result.success && ttsService.isConfigured && replyAdapter.sendVoiceNote) {
          const voiceText = state.finalResponse;
          const voiceWork = (async () => {
            const tts = await ttsService.synthesize({ text: voiceText.slice(0, 700) });
            if (tts.ok && tts.audioBase64 && replyAdapter.sendVoiceNote) {
              await replyAdapter.sendVoiceNote(orgId, { to: msg.from, audioBase64: tts.audioBase64, mimeType: tts.mimeType, idempotencyKey: `voicereply:${msg.providerMessageId}` });
            }
          })();
          try { waitUntil(voiceWork); } catch { void voiceWork; }
        }
      }

      // On a newly qualified lead: distil customer memory (Business Brain) and,
      // if configured, mirror into HubSpot. Both off the reply path.
      for (const tc of state.toolCalls) {
        if (tc.tool !== 'upsert_qualified_lead') continue;
        const out = tc.output as { leadId?: string } | undefined;
        if (!out?.leadId) continue;
        const mem = writeLeadMemory(orgId, msg.contactId, out.leadId)
          .then(() => distillCustomerMemory(orgId, msg.contactId!, msg.conversationId!));
        try { waitUntil(mem); } catch { void mem; }
        // Per-org HubSpot sync (resolves the merchant's own token; no-ops if none).
        const work = syncLeadToHubSpot(orgId, out.leadId);
        try { waitUntil(work); } catch { void work; }
        // Per-org Google Sheets append (no-ops if not connected / sync off).
        const sheetWork = appendLeadToSheet(orgId, out.leadId);
        try { waitUntil(sheetWork); } catch { void sheetWork; }
        // Marketing: attribute this conversion to a recent campaign touch.
        if (msg.contactId) {
          const conv = attributeConversion(orgId, msg.contactId);
          try { waitUntil(conv); } catch { void conv; }
        }
      }

      await idempotencyService.markProcessed(msg.providerMessageId, orgId);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error('Agent runtime error', { providerMessageId: msg.providerMessageId, error: errorMsg });
      await recordError('agent_runtime', errorMsg, { providerMessageId: msg.providerMessageId }, orgId);
      await idempotencyService.markProcessed(msg.providerMessageId, orgId, errorMsg);
    }
  }

  // ── Shared inbound pipeline: dedup → persist → agent ──
  // replyAdapter routes the answer back on the channel the message arrived on.
  async function ingestInboundMessages(messages: InboundMessage[], replyAdapter: WhatsAppAdapter, targetOrgId: string = defaultOrgId): Promise<void> {
    for (const msg of messages) {
      const acquired = await idempotencyService.tryAcquire(msg.providerMessageId);
      if (!acquired) {
        logger.info('Duplicate inbound event skipped', { providerMessageId: msg.providerMessageId });
        continue;
      }
      const stored = await messageService.persistInbound(targetOrgId, msg);
      await handleInbound(targetOrgId, {
        providerMessageId: msg.providerMessageId,
        from: msg.from,
        text: msg.text,
        type: msg.type,
        contactId: stored.contactId,
        conversationId: stored.conversationId,
        metadata: msg.metadata,
      }, replyAdapter);
    }
  }

  /** Resolve the Instagram/Messenger adapter + org for an inbound page id (per-tenant connection, else env default). */
  async function instagramForPage(pageId: string | undefined): Promise<{ orgId: string; adapter: InstagramMessengerAdapter } | null> {
    if (pageId) {
      try {
        const { data } = await db.from('integration_connections')
          .select('organization_id, config').eq('provider', 'instagram').eq('status', 'active')
          .filter('config->>pageId', 'eq', pageId).limit(1);
        const row = (data ?? [])[0] as { organization_id?: string; config?: Record<string, unknown> } | undefined;
        if (row?.organization_id && row.config) {
          const conn = await store.getIntegrationConnection(row.organization_id, 'instagram'); // decrypts the token
          const cfg = conn?.config ?? {};
          if (cfg['pageAccessToken']) {
            return { orgId: row.organization_id, adapter: new InstagramMessengerAdapter({
              pageId, pageAccessToken: String(cfg['pageAccessToken']),
              verifyToken: cfg['verifyToken'] ? String(cfg['verifyToken']) : verifyToken,
              channel: 'instagram',
            }) };
          }
        }
      } catch { /* fall through to env default */ }
    }
    if (instagramAdapter) return { orgId: defaultOrgId, adapter: instagramAdapter };
    return null;
  }

  /**
   * Close the loop after payment: a confirmed booking (travel/cab/maid) gets a
   * WhatsApp confirmation on the customer's own channel. Best-effort, off the
   * webhook's response path.
   */
  async function sendBookingConfirmation(orgId: string, bookingId: string): Promise<void> {
    try {
      const { data: booking } = await tenantDb(orgId).from('bookings')
        .select('booking_number, contact_id, metadata, total_amount')
        .eq('id', bookingId).maybeSingle();
      if (!booking?.contact_id) return;
      const contact = await store.findContactById(orgId, booking.contact_id); // real (decrypted) phone
      if (!contact?.phone) return;
      const meta = (booking.metadata ?? {}) as Record<string, unknown>;
      let detail = '';
      if (meta['type'] === 'cab-route') detail = ` Your ${meta['fromCity']} → ${meta['toCity']} cab is booked${meta['pickupDate'] ? ` for ${meta['pickupDate']}` : ''}.`;
      else if (meta['type'] === 'home-service') detail = ` Your ${meta['service']} service is booked${meta['startDate'] ? ` from ${meta['startDate']}` : ''}.`;
      const amountText = booking.total_amount ? ` (₹${Number(booking.total_amount).toLocaleString('en-IN')})` : '';
      const text = `✅ Payment received${amountText}! Booking ${booking.booking_number} is confirmed.${detail} Thank you — we’ll follow up with the details shortly. 🙌`;
      const orgAdapter = await adapterForOrg(orgId);
      const r = await orgAdapter.sendMessage(orgId, { to: contact.phone, type: 'text', text, idempotencyKey: `bookpay:${bookingId}` });
      if (r.success && r.providerMessageId) await messageService.persistOutbound(orgId, contact.phone, text, r.providerMessageId);
    } catch (err) {
      logger.warn('Booking confirmation send failed', { orgId, bookingId, error: err instanceof Error ? err.message : String(err) });
    }
  }

  /** Business Brain: distil durable facts about a customer from a new lead. */
  async function writeLeadMemory(orgId: string, contactId: string, leadId: string): Promise<void> {
    try {
      const { data: lead } = await tenantDb(orgId).from('leads')
        .select('service_interest, budget_range, purchase_timeline').eq('id', leadId).maybeSingle();
      if (!lead) return;
      const facts: string[] = [];
      if (lead.service_interest) facts.push(`Interested in: ${String(lead.service_interest).slice(0, 200)}`);
      if (lead.budget_range) facts.push(`Budget: ${lead.budget_range}`);
      if (lead.purchase_timeline) facts.push(`Timeline: ${lead.purchase_timeline}`);
      for (const body of facts) {
        await store.addContactNote(orgId, { contactId, kind: 'memory', body }); // dedups identical facts
      }
    } catch { /* memory is best-effort */ }
  }

  /**
   * Business Brain (LLM): read the recent conversation and extract DURABLE,
   * free-form customer facts ("prefers beaches", "travels with family",
   * "budget ~₹1L") as memory notes. Runs off the reply path, only when a lead
   * is qualified (bounds cost), and dedups against what's already stored.
   */
  async function distillCustomerMemory(orgId: string, contactId: string, conversationId: string): Promise<void> {
    try {
      const { data: msgs } = await db.from('messages')
        .select('direction, content').eq('conversation_id', conversationId)
        .order('created_at', { ascending: false }).limit(16);
      const convo = (msgs ?? []).reverse()
        .map((m) => `${m.direction === 'inbound' ? 'Customer' : 'Business'}: ${m.content}`)
        .join('\n').slice(0, 3000);
      if (convo.length < 40) return;
      const existing = (await store.getContactNotes(orgId, contactId)).filter((n) => n.kind === 'memory').map((n) => n.body);
      const completion = await llm.generateCompletion({
        organizationId: orgId, maxTokens: 260,
        messages: [{ role: 'user', content:
          `From this WhatsApp conversation, extract DURABLE facts about the CUSTOMER for a small-business CRM — only stable preferences/attributes (e.g. "Prefers beach destinations", "Budget around ₹1 lakh", "Travels with family", "Prefers Hindi", "Vegetarian"). Ignore one-off logistics, specific dates, greetings, and anything transient. Do NOT repeat any of these existing facts: ${JSON.stringify(existing)}. Return ONLY a JSON array of short strings (max 5); return [] if nothing new.\n\nConversation:\n${convo}` }],
      });
      const raw = completion.content.replace(/```json|```/g, '');
      const start = raw.indexOf('['); const end = raw.lastIndexOf(']');
      if (start === -1 || end === -1) return;
      const facts = JSON.parse(raw.slice(start, end + 1)) as unknown;
      if (!Array.isArray(facts)) return;
      for (const f of facts.slice(0, 5)) {
        if (typeof f === 'string' && f.trim().length > 3) {
          await store.addContactNote(orgId, { contactId, kind: 'memory', body: f.trim().slice(0, 200) });
        }
      }
    } catch (err) {
      logger.warn('memory distillation failed', { orgId, error: err instanceof Error ? err.message : String(err) });
    }
  }

  /**
   * Ported CrewAI trip planner: generate a day-by-day itinerary + budget for a
   * travel quote's destination and attach it to the quote (itineraries table).
   * Runs off the reply path (3 LLM calls). Best-effort.
   */
  async function generateItineraryForQuote(orgId: string, quoteId: string, packageSku: string, travellers: number, amount: number): Promise<void> {
    try {
      const { data: pkg } = await tenantDb(orgId).from('packages')
        .select('title, duration_days, destinations(name)').eq('sku', packageSku).maybeSingle();
      if (!pkg) return;
      const destRel = pkg.destinations as { name?: string } | { name?: string }[] | null;
      const destName = Array.isArray(destRel) ? destRel[0]?.name : destRel?.name;
      const destination = destName || String(pkg.title ?? '').split(/[·\-–—]/)[0]?.trim() || String(pkg.title ?? 'your destination');
      const durationDays = Number(pkg.duration_days) || 3;
      const plan = await planItinerary(llm, orgId, {
        destination, durationDays, travellers,
        budgetText: `₹${Number(amount).toLocaleString('en-IN')} total`,
      });
      await tenantDb(orgId).from('itineraries').insert({
        quote_id: quoteId,
        title: `${destination} · ${durationDays}-day itinerary`.slice(0, 255),
        day_by_day: { ...plan, generatedAt: new Date().toISOString(), source: 'ai-itinerary-planner' },
      });
      logger.info('Itinerary generated for quote', { orgId, quoteId, destination });
    } catch (err) {
      logger.warn('Itinerary generation failed', { orgId, quoteId, error: err instanceof Error ? err.message : String(err) });
    }
  }

  /** The most recent booking for a contact that is still awaiting payment, if any. */
  async function latestPendingBookingForContact(orgId: string, contactId: string): Promise<{ id: string; bookingNumber: string } | null> {
    const { data } = await tenantDb(orgId).from('bookings')
      .select('id, booking_number').eq('contact_id', contactId)
      .in('status', ['pending', 'pending_payment']).order('created_at', { ascending: false }).limit(1);
    const b = (data ?? [])[0];
    return b ? { id: b.id, bookingNumber: b.booking_number } : null;
  }

  /**
   * Confirm the org's latest pending booking (optionally matching a customer
   * name) as paid — for the merchant "Paid"/"Confirm <name>" WhatsApp reply.
   * Returns the confirmed booking number, or null if none matched.
   */
  async function confirmLatestPendingBooking(orgId: string, nameHint: string | null, actorUserId?: string): Promise<string | null> {
    const { data } = await tenantDb(orgId).from('bookings')
      .select('id, booking_number, contacts(name)')
      .in('status', ['pending', 'pending_payment']).order('created_at', { ascending: false }).limit(15);
    const rows = data ?? [];
    let target = nameHint ? undefined : rows[0];
    if (nameHint) {
      // With a name hint, only confirm a booking that actually matches it —
      // never fall back to a random pending booking.
      target = rows.find((b: { contacts?: unknown }) => {
        const c = b.contacts as { name?: string } | { name?: string }[] | null;
        const name = Array.isArray(c) ? c[0]?.name : c?.name;
        return name && name.toLowerCase().includes(nameHint.toLowerCase());
      });
    }
    if (!target) return null;
    await tenantDb(orgId).from('bookings').update({ status: 'confirmed' }).eq('id', target.id);
    await store.insertAuditEvent({ id: randomUUID(), organizationId: orgId, action: 'booking_marked_paid', entityType: 'booking', entityId: target.id, actorType: 'user', details: { by: actorUserId ?? 'merchant-whatsapp', method: 'whatsapp' }, createdAt: new Date().toISOString() });
    await audit(orgId, 'booking.confirm', { actor: actorUserId ?? 'merchant-whatsapp', resource: 'bookings', resourceId: target.id, operation: 'update' });
    const work = sendBookingConfirmation(orgId, target.id);
    try { waitUntil(work); } catch { void work; }
    return target.booking_number;
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

  const platformAdminEmail = (env['PLATFORM_ADMIN_EMAIL'] ?? 'puneetj79@gmail.com').toLowerCase();
  /** Platform-admin gate (merchant management) — the signed-in user must be the platform admin. */
  async function authoriseAdmin(req: express.Request): Promise<{ userId: string; email: string } | null> {
    const auth = req.headers.authorization;
    if (!auth?.startsWith('Bearer ')) return null;
    const user = await verifySupabaseAccessToken({ supabaseUrl: supabaseUrl!, anonKey: anonKey!, accessToken: auth.slice(7) });
    if (!user?.email || user.email.toLowerCase() !== platformAdminEmail) return null;
    return { userId: user.userId, email: user.email };
  }

  // ── Payments ──
  // Platform-level Razorpay (env) is the fallback for the default org. Each
  // merchant connects their OWN Razorpay account (Model A) via onboarding; those
  // keys are stored encrypted and resolved per-org here, so money settles to the
  // merchant and Razorpay's KYC applies to them — no aggregator licence needed.
  const razorpay = env['RAZORPAY_KEY_ID'] && env['RAZORPAY_KEY_SECRET']
    ? new RazorpayPaymentService({
        keyId: env['RAZORPAY_KEY_ID'],
        keySecret: env['RAZORPAY_KEY_SECRET'],
        webhookSecret: env['RAZORPAY_WEBHOOK_SECRET'],
        supabase: db,
      })
    : null;

  const razorpayCache = new Map<string, RazorpayPaymentService | null>();
  /** The Razorpay service for an org — its own connected account, else the platform key. */
  async function razorpayForOrg(orgId: string): Promise<RazorpayPaymentService | null> {
    const cached = razorpayCache.get(orgId);
    if (cached !== undefined) return cached;
    let svc: RazorpayPaymentService | null = null;
    try {
      const conn = await store.getPaymentConnection(orgId);
      if (conn?.keyId && conn.keySecret && conn.status === 'active') {
        svc = new RazorpayPaymentService({ keyId: conn.keyId, keySecret: conn.keySecret, webhookSecret: conn.webhookSecret, supabase: db });
      }
    } catch (err) {
      logger.warn('razorpayForOrg lookup failed', { orgId, error: err instanceof Error ? err.message : String(err) });
    }
    if (!svc) svc = razorpay; // platform fallback (default org / not-yet-connected)
    razorpayCache.set(orgId, svc);
    return svc;
  }

  /**
   * Gateway-free UPI fallback: when a merchant has no Razorpay but has set their
   * own UPI VPA, return the hosted pay page for a booking (customer pays UPI
   * directly into the merchant's VPA; confirmation is manual). Returns null if
   * the org has no UPI configured.
   */
  async function upiPageForBooking(orgId: string, bookingId: string): Promise<string | null> {
    try {
      const { data: o } = await db.from('organizations').select('upi_vpa').eq('id', orgId).maybeSingle();
      if (!o?.upi_vpa) return null;
      return `${publicBaseUrl}/pay/upi/${bookingId}`;
    } catch {
      return null;
    }
  }

  // ── Production routes ──
  const registerRoutes = (app: express.Express): void => {
    /** Public quotation document (opened by the customer from a WhatsApp link). */
    app.get('/doc/quote/:id', async (req, res) => {
      try {
        const { data: quote } = await db.from('quotes')
          .select('id, organization_id, contact_id, package_id, quote_number, amount, valid_until, created_at')
          .eq('id', req.params.id).maybeSingle();
        if (!quote) { res.status(404).type('html').send('<h1>Quotation not found</h1>'); return; }

        const [{ data: org }, { data: contact }, { data: pkg }] = await Promise.all([
          db.from('organizations').select('name').eq('id', quote.organization_id).maybeSingle(),
          db.from('contacts').select('name, phone_number').eq('id', quote.contact_id).maybeSingle(),
          quote.package_id ? db.from('packages').select('title, price_per_person').eq('id', quote.package_id).maybeSingle() : Promise.resolve({ data: null }),
        ]);

        const unit = Number(pkg?.price_per_person ?? quote.amount);
        const qty = unit > 0 ? Math.max(1, Math.round(Number(quote.amount) / unit)) : 1;
        let html = buildQuotationHtml({
          number: quote.quote_number,
          businessName: org?.name ?? 'SaarthiOne',
          customerName: contact?.name ?? undefined,
          customerPhone: contact?.phone_number ?? undefined,
          currency: 'INR',
          issuedAt: quote.created_at,
          validUntil: quote.valid_until,
          items: [{ title: pkg?.title ?? 'Holiday package', quantity: qty, unitPrice: unit }],
          notes: 'Thank you for your interest! This quotation is valid until the date shown above.',
        });

        // Attach the AI-generated itinerary, if one has been produced for this quote.
        const { data: itinRows } = await tenantDb(quote.organization_id).from('itineraries')
          .select('title, day_by_day').eq('quote_id', quote.id)
          .order('created_at', { ascending: false }).limit(1);
        const itin = itinRows?.[0] as { title?: string; day_by_day?: unknown } | undefined;
        const plan = (itin?.day_by_day && typeof itin.day_by_day === 'object') ? itin.day_by_day as { destinationInsights?: string; dayByDay?: string; budgetBreakdown?: string } : null;
        if (plan) {
          const esc = (s: unknown) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] as string));
          const sect = (title: string, body?: string) => body ? `<h2 style="font-size:17px;margin:22px 0 8px;color:#0e7c86">${esc(title)}</h2><div style="white-space:pre-wrap;line-height:1.6;color:#333;font-size:14px">${esc(body)}</div>` : '';
          const block = `<section style="max-width:720px;margin:8px auto 40px;padding:24px;border-top:2px solid #eee;font-family:system-ui,-apple-system,sans-serif">`
            + `<h1 style="font-size:22px;margin:0 0 4px">🗺️ ${esc(itin?.title ?? 'Your itinerary')}</h1>`
            + `<div style="color:#888;font-size:12px;margin-bottom:6px">AI-generated trip plan — review &amp; personalise with your travel expert.</div>`
            + sect('Destination insights', plan.destinationInsights)
            + sect('Day-by-day itinerary', plan.dayByDay)
            + sect('Indicative budget', plan.budgetBreakdown)
            + `</section>`;
          html = html.includes('</body>') ? html.replace('</body>', `${block}</body>`) : html + block;
        }
        res.status(200).type('html').send(html);
      } catch (err) {
        res.status(500).type('html').send('<h1>Could not load quotation</h1>');
      }
    });

    /** Public invoice document. */
    app.get('/doc/invoice/:id', async (req, res) => {
      try {
        const { data: invoice } = await db.from('invoices')
          .select('id, organization_id, order_id, invoice_number, amount_due, amount_paid, due_date, status, created_at')
          .eq('id', req.params.id).maybeSingle();
        if (!invoice) { res.status(404).type('html').send('<h1>Invoice not found</h1>'); return; }

        const [{ data: org }, { data: order }] = await Promise.all([
          db.from('organizations').select('name').eq('id', invoice.organization_id).maybeSingle(),
          db.from('orders').select('contact_id, order_items(title, quantity, unit_price)').eq('id', invoice.order_id).maybeSingle(),
        ]);
        const { data: contact } = order?.contact_id
          ? await db.from('contacts').select('name, phone_number').eq('id', order.contact_id).maybeSingle()
          : { data: null };

        const items = ((order?.order_items as Array<{ title: string; quantity: number; unit_price: number }> | undefined) ?? [])
          .map((i) => ({ title: i.title, quantity: i.quantity, unitPrice: Number(i.unit_price) }));
        const html = buildInvoiceHtml({
          number: invoice.invoice_number,
          businessName: org?.name ?? 'SaarthiOne',
          customerName: contact?.name ?? undefined,
          customerPhone: contact?.phone_number ?? undefined,
          currency: 'INR',
          issuedAt: invoice.created_at,
          dueDate: invoice.due_date,
          status: (invoice.status as 'unpaid' | 'paid' | 'partially_paid') ?? 'unpaid',
          items: items.length > 0 ? items : [{ title: 'Order total', quantity: 1, unitPrice: Number(invoice.amount_due) }],
          amountPaid: Number(invoice.amount_paid ?? 0),
        });
        res.status(200).type('html').send(html);
      } catch (err) {
        res.status(500).type('html').send('<h1>Could not load invoice</h1>');
      }
    });

    /**
     * Twilio WhatsApp inbound webhook (form-encoded).
     * Signature-verified against the exact configured public URL.
     */
    app.post('/webhooks/twilio', express.urlencoded({ extended: false }), (req, res) => {
      if (!twilioAdapter) {
        res.status(503).type('text/xml').send('<Response></Response>');
        return;
      }
      const form = (req.body ?? {}) as Record<string, string>;
      const signature = req.headers['x-twilio-signature'];
      const publicUrl = env['TWILIO_WEBHOOK_URL']
        ?? `https://${req.headers['x-forwarded-host'] ?? req.headers.host}${req.originalUrl}`;
      if (!twilioAdapter.verifySignature(publicUrl, form, typeof signature === 'string' ? signature : undefined)) {
        logger.warn('Twilio webhook rejected: invalid X-Twilio-Signature', { publicUrl });
        res.status(403).type('text/xml').send('<Response></Response>');
        return;
      }

      // Empty TwiML ack — the agent reply is sent asynchronously via the API.
      res.status(200).type('text/xml').send('<Response></Response>');

      // Twilio conversations are always answered back through Twilio.
      const work = ingestInboundMessages(twilioAdapter.parseInboundEvent(form), twilioAdapter);
      try {
        waitUntil(work);
      } catch {
        void work;
      }
    });

    /**
     * WhatsApp Embedded Signup completion. The dashboard sends the OAuth `code`
     * from Meta's Embedded Signup; we exchange it for a business token, discover
     * the phone number, subscribe our app to the WABA, and store the connection
     * against the operator's organization — making the platform multi-tenant.
     */
    const SignupSchema = z.object({
      code: z.string().min(1),
      phoneNumberId: z.string().optional(),
      wabaId: z.string().optional(),
    });
    app.post('/api/onboarding/whatsapp', async (req, res) => {
      const operator = await authoriseOperator(req);
      if (!operator) { res.status(401).json({ error: 'Unauthorized' }); return; }
      const parsed = SignupSchema.safeParse(req.body);
      if (!parsed.success) { res.status(400).json({ error: 'Invalid request', details: parsed.error.issues }); return; }

      const appId = env['META_APP_ID'];
      const appSecret = env['META_APP_SECRET'];
      if (!appId || !appSecret) { res.status(503).json({ error: 'Meta app credentials not configured on the server.' }); return; }

      try {
        // 1. Exchange the Embedded Signup code for a business access token.
        const tokenRes = await fetch(`https://graph.facebook.com/v21.0/oauth/access_token?client_id=${appId}&client_secret=${appSecret}&code=${encodeURIComponent(parsed.data.code)}`);
        const tokenJson = (await tokenRes.json()) as { access_token?: string; error?: { message?: string } };
        if (!tokenRes.ok || !tokenJson.access_token) {
          res.status(400).json({ error: `Token exchange failed: ${tokenJson.error?.message ?? 'unknown'}` });
          return;
        }
        const accessToken = tokenJson.access_token;

        // 2. Resolve the WABA + phone number (use provided values, else discover).
        let wabaId = parsed.data.wabaId;
        let phoneNumberId = parsed.data.phoneNumberId;
        if (!wabaId) {
          const wabaRes = await fetch(`https://graph.facebook.com/v21.0/debug_token?input_token=${accessToken}&access_token=${appId}|${appSecret}`);
          const wabaJson = (await wabaRes.json()) as { data?: { granular_scopes?: Array<{ scope: string; target_ids?: string[] }> } };
          wabaId = wabaJson.data?.granular_scopes?.find((s) => s.scope === 'whatsapp_business_management')?.target_ids?.[0];
        }
        if (wabaId && !phoneNumberId) {
          const phoneRes = await fetch(`https://graph.facebook.com/v21.0/${wabaId}/phone_numbers?access_token=${accessToken}`);
          const phoneJson = (await phoneRes.json()) as { data?: Array<{ id: string }> };
          phoneNumberId = phoneJson.data?.[0]?.id;
        }
        if (!phoneNumberId) { res.status(400).json({ error: 'Could not resolve the WhatsApp phone number from signup.' }); return; }

        // 3. Read the display number, and subscribe our app to the WABA for webhooks.
        const numRes = await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}?fields=display_phone_number,verified_name&access_token=${accessToken}`);
        const numJson = (await numRes.json()) as { display_phone_number?: string; verified_name?: string };
        if (wabaId) {
          await fetch(`https://graph.facebook.com/v21.0/${wabaId}/subscribed_apps`, { method: 'POST', headers: { Authorization: `Bearer ${accessToken}` } });
        }

        // 4. Persist the connection against the operator's org.
        await store.saveWhatsAppConnection({
          organizationId: operator.organizationId, wabaId, phoneNumberId,
          displayPhoneNumber: numJson.display_phone_number, verifiedName: numJson.verified_name,
          accessToken, connectedBy: operator.userId,
        });
        orgAdapterCache.delete(phoneNumberId);

        logger.info('WhatsApp connected via Embedded Signup', { organizationId: operator.organizationId, phoneNumberId });
        res.status(200).json({ ok: true, displayPhoneNumber: numJson.display_phone_number, phoneNumberId });
      } catch (err) {
        logger.error('Embedded Signup failed', { error: err instanceof Error ? err.message : String(err) });
        res.status(500).json({ error: err instanceof Error ? err.message : 'Signup failed' });
      }
    });

    // ── Merchant onboarding: profile, payments (own Razorpay), terms, status ──
    const strField = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

    app.post('/api/onboarding/profile', async (req, res) => {
      const op = await authoriseOperator(req);
      if (!op) { res.status(401).json({ ok: false, error: 'Unauthorized' }); return; }
      const b = (req.body ?? {}) as Record<string, unknown>;
      const legalName = strField(b['legalName']);
      if (!legalName) { res.status(400).json({ ok: false, error: 'Business name is required' }); return; }
      const { error } = await db.from('organizations').update({
        legal_name: legalName,
        business_type: strField(b['businessType']),
        contact_name: strField(b['contactName']),
        contact_phone: strField(b['contactPhone']),
        city: strField(b['city']),
        gst_number: strField(b['gstNumber']),
        pan: strField(b['pan']),
      }).eq('id', op.organizationId);
      if (error) { res.status(500).json({ ok: false, error: error.message }); return; }
      res.status(200).json({ ok: true });
    });

    /** Connect the merchant's OWN Razorpay account (Model A) — keys stored encrypted. */
    app.post('/api/onboarding/payment', async (req, res) => {
      const op = await authoriseOperator(req);
      if (!op) { res.status(401).json({ ok: false, error: 'Unauthorized' }); return; }
      const b = (req.body ?? {}) as { keyId?: string; keySecret?: string; webhookSecret?: string };
      const keyId = (b.keyId ?? '').trim();
      const keySecret = (b.keySecret ?? '').trim();
      if (!keyId || !keySecret) { res.status(400).json({ ok: false, error: 'Razorpay Key ID and Key Secret are required' }); return; }
      if (!/^rzp_(test|live)_/.test(keyId)) { res.status(400).json({ ok: false, error: 'That does not look like a Razorpay key (expected rzp_test_… or rzp_live_…)' }); return; }
      // Validate the credentials against Razorpay before persisting them.
      try {
        const probe = await fetch('https://api.razorpay.com/v1/payment_links?count=1', {
          headers: { Authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString('base64')}` },
        });
        if (probe.status === 401) { res.status(400).json({ ok: false, error: 'Razorpay rejected these credentials — double-check the Key ID and Secret.' }); return; }
      } catch { /* transient network issue — persist anyway, the merchant can retry */ }
      const mode: 'test' | 'live' = keyId.startsWith('rzp_live_') ? 'live' : 'test';
      try {
        await store.savePaymentConnection(op.organizationId, { keyId, keySecret, webhookSecret: strField(b.webhookSecret) ?? undefined, mode });
        razorpayCache.delete(op.organizationId); // pick up the new keys immediately
        await audit(op.organizationId, 'payment.connect', { actor: 'user:' + op.userId, resource: 'payment_connections', operation: 'update', details: { mode } });
        res.status(200).json({ ok: true, mode });
      } catch (err) {
        res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
      }
    });

    /** Connect the merchant's own UPI ID (gateway-free; manual confirmation). */
    app.post('/api/onboarding/upi', async (req, res) => {
      const op = await authoriseOperator(req);
      if (!op) { res.status(401).json({ ok: false, error: 'Unauthorized' }); return; }
      const b = (req.body ?? {}) as { upiVpa?: string; payeeName?: string };
      const vpa = (b.upiVpa ?? '').trim();
      if (!vpa || !/^[\w.-]{2,}@[\w.-]{2,}$/.test(vpa)) {
        res.status(400).json({ ok: false, error: 'Enter a valid UPI ID, e.g. yourname@okhdfcbank' }); return;
      }
      const { error } = await db.from('organizations')
        .update({ upi_vpa: vpa, upi_payee_name: strField(b.payeeName) })
        .eq('id', op.organizationId);
      if (error) { res.status(500).json({ ok: false, error: error.message }); return; }
      await audit(op.organizationId, 'upi.connect', { actor: 'user:' + op.userId, resource: 'organizations', operation: 'update' });
      res.status(200).json({ ok: true });
    });

    app.post('/api/onboarding/terms', async (req, res) => {
      const op = await authoriseOperator(req);
      if (!op) { res.status(401).json({ ok: false, error: 'Unauthorized' }); return; }
      const version = strField((req.body as { termsVersion?: unknown })?.termsVersion) ?? 'v1';
      const now = new Date().toISOString();
      const { error } = await db.from('organizations')
        .update({ terms_accepted_at: now, terms_version: version, whatsapp_consent_at: now })
        .eq('id', op.organizationId);
      if (error) { res.status(500).json({ ok: false, error: error.message }); return; }
      res.status(200).json({ ok: true });
    });

    app.post('/api/onboarding/complete', async (req, res) => {
      const op = await authoriseOperator(req);
      if (!op) { res.status(401).json({ ok: false, error: 'Unauthorized' }); return; }
      // Self-serve goes live immediately unless approval is required.
      const status = env['REQUIRE_MERCHANT_APPROVAL'] === 'true' ? 'pending_review' : 'active';
      const { error } = await db.from('organizations').update({ onboarding_status: status }).eq('id', op.organizationId);
      if (error) { res.status(500).json({ ok: false, error: error.message }); return; }
      await audit(op.organizationId, 'onboarding.complete', { actor: 'user:' + op.userId, operation: 'update', details: { status } });
      res.status(200).json({ ok: true, status });
    });

    app.get('/api/onboarding/state', async (req, res) => {
      const op = await authoriseOperator(req);
      if (!op) { res.status(401).json({ ok: false, error: 'Unauthorized' }); return; }
      const { data: org } = await db.from('organizations')
        .select('legal_name, terms_accepted_at, onboarding_status, upi_vpa').eq('id', op.organizationId).maybeSingle();
      const conn = await store.getPaymentConnection(op.organizationId).catch(() => null);
      res.status(200).json({
        ok: true,
        profileComplete: !!org?.legal_name,
        paymentConnected: !!conn,
        upiConnected: !!org?.upi_vpa,
        termsAccepted: !!org?.terms_accepted_at,
        status: org?.onboarding_status ?? 'active',
      });
    });

    /** Customer UPI pay page (gateway-free): opens the merchant's UPI intent. */
    app.get('/pay/upi/:bookingId', async (req, res) => {
      const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
      const { data: booking } = await db.from('bookings')
        .select('booking_number, total_amount, organization_id, status').eq('id', req.params.bookingId).maybeSingle();
      if (!booking) { res.status(404).type('html').send('<h1>Payment not found</h1>'); return; }
      const { data: org } = await db.from('organizations')
        .select('name, upi_vpa, upi_payee_name').eq('id', booking.organization_id).maybeSingle();
      if (!org?.upi_vpa) { res.status(400).type('html').send('<h1>UPI is not set up for this business</h1>'); return; }
      const amount = Number(booking.total_amount || 0);
      const payee = org.upi_payee_name || org.name || 'Merchant';
      const note = `Booking ${booking.booking_number}`;
      const upi = `upi://pay?pa=${encodeURIComponent(org.upi_vpa)}&pn=${encodeURIComponent(payee)}&am=${amount}&cu=INR&tn=${encodeURIComponent(note)}&tr=${encodeURIComponent(booking.booking_number)}`;
      const paid = booking.status === 'confirmed' || booking.status === 'paid';
      // Scannable QR (for desktop / another device); the button covers same-device.
      let qrSvg = '';
      if (!paid) {
        try { qrSvg = await QRCode.toString(upi, { type: 'svg', margin: 1, color: { dark: '#0b0f16', light: '#ffffff' } }); } catch { qrSvg = ''; }
      }
      res.status(200).type('html').send(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Pay ${esc(payee)}</title>
<style>*{box-sizing:border-box;margin:0}body{font-family:system-ui,-apple-system,sans-serif;background:#0b0f16;color:#eef2f7;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:20px}
.card{background:#0e1420;border:1px solid rgba(255,255,255,.1);border-radius:20px;max-width:380px;width:100%;padding:28px;text-align:center}
.amt{font-size:40px;font-weight:800;margin:8px 0 2px}.muted{color:#94a3b8;font-size:14px}
.vpa{background:#0b0e15;border:1px solid rgba(255,255,255,.12);border-radius:10px;padding:12px;margin:18px 0;font-family:monospace;font-size:15px;word-break:break-all}
.btn{display:block;background:linear-gradient(135deg,#00e5ff,#4facfe);color:#00232b;font-weight:800;padding:15px;border-radius:12px;text-decoration:none;font-size:16px;margin-top:6px}
.ok{color:#25d366;font-weight:700;font-size:18px;margin:10px 0}.steps{text-align:left;color:#94a3b8;font-size:13px;line-height:1.7;margin-top:20px}
.qr{background:#fff;border-radius:14px;padding:12px;width:200px;margin:18px auto 6px}.qr svg{width:100%;height:auto;display:block}</style></head>
<body><div class="card">
<div class="muted">Pay to</div><div style="font-size:18px;font-weight:700">${esc(payee)}</div>
<div class="amt">₹${amount.toLocaleString('en-IN')}</div><div class="muted">${esc(note)}</div>
${paid ? '<div class="ok">✅ Payment received — booking confirmed</div>' : `
${qrSvg ? `<div class="qr">${qrSvg}</div><div class="muted" style="font-size:12px">Scan with any UPI app</div>` : ''}
<div class="vpa">${esc(org.upi_vpa)}</div>
<a class="btn" href="${esc(upi)}">Pay ₹${amount.toLocaleString('en-IN')} via UPI app</a>
<div class="steps">1. Scan the QR, or tap the button to open GPay / PhonePe / Paytm.<br>2. Confirm the payment of ₹${amount.toLocaleString('en-IN')}.<br>3. The business will confirm your booking once the payment reflects.</div>`}
</div></body></html>`);
    });

    // ── AI configuration: business rules (L5) + AI team (L1) ──
    app.get('/api/config', async (req, res) => {
      const op = await authoriseOperator(req);
      if (!op) { res.status(401).json({ ok: false, error: 'Unauthorized' }); return; }
      const { data } = await db.from('organizations').select('business_rules, enabled_agents').eq('id', op.organizationId).maybeSingle();
      res.status(200).json({
        ok: true,
        rules: data?.business_rules ?? {},
        enabledAgents: Array.isArray(data?.enabled_agents) ? data!.enabled_agents : ['sales', 'support', 'booking', 'operations'],
      });
    });

    app.post('/api/config/rules', async (req, res) => {
      const op = await authoriseOperator(req);
      if (!op) { res.status(401).json({ ok: false, error: 'Unauthorized' }); return; }
      const b = (req.body ?? {}) as Record<string, unknown>;
      const rules: Record<string, unknown> = {};
      if (typeof b['maxDiscountPercent'] === 'number') rules['maxDiscountPercent'] = Math.max(0, Math.min(100, b['maxDiscountPercent']));
      if (typeof b['bookingRequiresPayment'] === 'boolean') rules['bookingRequiresPayment'] = b['bookingRequiresPayment'];
      if (typeof b['refundRequiresApproval'] === 'boolean') rules['refundRequiresApproval'] = b['refundRequiresApproval'];
      const wh = b['workingHours'] as Record<string, unknown> | undefined;
      if (wh && typeof wh === 'object') rules['workingHours'] = { start: strField(wh['start']) ?? undefined, end: strField(wh['end']) ?? undefined, timezone: strField(wh['timezone']) ?? 'Asia/Kolkata' };
      if (Array.isArray(b['languages'])) rules['languages'] = (b['languages'] as unknown[]).filter((x) => typeof x === 'string').slice(0, 10);
      if (typeof b['tone'] === 'string') rules['tone'] = (b['tone'] as string).slice(0, 40);
      const { error } = await db.from('organizations').update({ business_rules: rules }).eq('id', op.organizationId);
      orgCache.delete(op.organizationId);
      if (error) { res.status(500).json({ ok: false, error: error.message }); return; }
      await audit(op.organizationId, 'config.rules', { actor: 'user:' + op.userId, operation: 'update' });
      res.status(200).json({ ok: true });
    });

    app.post('/api/config/team', async (req, res) => {
      const op = await authoriseOperator(req);
      if (!op) { res.status(401).json({ ok: false, error: 'Unauthorized' }); return; }
      const allowed = ['sales', 'support', 'booking', 'operations'];
      const input = (req.body as { enabledAgents?: unknown })?.enabledAgents;
      const arr = Array.isArray(input) ? (input as unknown[]).filter((x): x is string => typeof x === 'string' && allowed.includes(x)) : allowed;
      const { error } = await db.from('organizations').update({ enabled_agents: arr }).eq('id', op.organizationId);
      orgCache.delete(op.organizationId);
      if (error) { res.status(500).json({ ok: false, error: error.message }); return; }
      await audit(op.organizationId, 'config.team', { actor: 'user:' + op.userId, operation: 'update' });
      res.status(200).json({ ok: true, enabledAgents: arr });
    });

    /** Test Conversation sandbox — run the fully-configured agent, no WhatsApp send. */
    app.post('/api/agent/test', async (req, res) => {
      const op = await authoriseOperator(req);
      if (!op) { res.status(401).json({ ok: false, error: 'Unauthorized' }); return; }
      const message = strField((req.body as { message?: unknown })?.message);
      if (!message) { res.status(400).json({ ok: false, error: 'message required' }); return; }
      try {
        const org = await getOrgContext(op.organizationId);
        const inbound: InboundMessage = { providerMessageId: `sandbox:${randomUUID()}`, from: '+000000000000', timestamp: new Date(), type: 'text', text: message, metadata: { channel: 'sandbox' } };
        const stored = await messageService.persistInbound(op.organizationId, inbound);
        if (!stored.contactId || !stored.conversationId) { res.status(500).json({ ok: false, error: 'sandbox init failed' }); return; }
        const state = await executeAgentGraph(store, {
          organizationId: op.organizationId, contactId: stored.contactId, conversationId: stored.conversationId,
          inboundMessage: message, traceId: inbound.providerMessageId,
        }, agentDeps(op.organizationId, org));
        if (state.finalResponse) await messageService.persistOutbound(op.organizationId, inbound.from, state.finalResponse, `sandbox-out:${randomUUID()}`, stored.conversationId);
        res.status(200).json({ ok: true, reply: state.finalResponse ?? '(no reply generated)', intent: state.intent });
      } catch (err) {
        res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
      }
    });

    /** Bookings awaiting payment confirmation (for the operator dashboard). */
    app.get('/api/bookings/pending', async (req, res) => {
      const op = await authoriseOperator(req);
      if (!op) { res.status(401).json({ ok: false, error: 'Unauthorized' }); return; }
      const { data } = await tenantDb(op.organizationId).from('bookings')
        .select('id, booking_number, total_amount, currency, status, metadata, created_at, contacts(name)')
        .in('status', ['pending', 'pending_payment'])
        .order('created_at', { ascending: false }).limit(100);
      const bookings = (data ?? []).map((b: { id: string; booking_number: string; total_amount: number | null; status: string; metadata: unknown; created_at: string; contacts?: unknown }) => {
        const c = b.contacts as { name?: string } | { name?: string }[] | null;
        const name = Array.isArray(c) ? c[0]?.name : c?.name;
        const meta = (b.metadata ?? {}) as Record<string, unknown>;
        return {
          id: b.id, bookingNumber: b.booking_number, amount: Number(b.total_amount || 0),
          status: b.status, customerName: name ?? null, createdAt: b.created_at,
          summary: meta['type'] === 'cab-route' ? `${meta['fromCity']} → ${meta['toCity']} (${meta['vehicleClass']})`
            : meta['type'] === 'home-service' ? `${meta['service']} · ${meta['planType']}` : 'Booking',
        };
      });
      res.status(200).json({ ok: true, bookings });
    });

    /** Operator marks a booking as paid → confirm + WhatsApp confirmation (for UPI/manual). */
    app.post('/api/bookings/:id/confirm', async (req, res) => {
      const op = await authoriseOperator(req);
      if (!op) { res.status(401).json({ ok: false, error: 'Unauthorized' }); return; }
      const bookingId = req.params.id;
      const { data: booking } = await tenantDb(op.organizationId).from('bookings')
        .select('id, status').eq('id', bookingId).maybeSingle();
      if (!booking) { res.status(404).json({ ok: false, error: 'Booking not found' }); return; }
      if (booking.status === 'confirmed' || booking.status === 'paid') { res.status(200).json({ ok: true, alreadyConfirmed: true }); return; }
      await tenantDb(op.organizationId).from('bookings').update({ status: 'confirmed' }).eq('id', bookingId);
      await store.insertAuditEvent({ id: randomUUID(), organizationId: op.organizationId, action: 'booking_marked_paid', entityType: 'booking', entityId: bookingId, actorType: 'user', details: { by: op.userId, method: 'manual' }, createdAt: new Date().toISOString() });
      await audit(op.organizationId, 'booking.confirm', { actor: 'user:' + op.userId, resource: 'bookings', resourceId: bookingId, operation: 'update' });
      // Notify the customer on WhatsApp (off the response path).
      const work = sendBookingConfirmation(op.organizationId, bookingId);
      try { waitUntil(work); } catch { void work; }
      res.status(200).json({ ok: true });
    });

    // ── Platform admin: merchant management (approval gate UI) ──
    app.get('/api/admin/merchants', async (req, res) => {
      const admin = await authoriseAdmin(req);
      if (!admin) { res.status(200).json({ ok: true, isAdmin: false, merchants: [] }); return; } // 200 so the UI just hides the tab
      const { data } = await db.from('organizations')
        .select('id, name, legal_name, onboarding_status, created_at').order('created_at', { ascending: false }).limit(500);
      const merchants = (data ?? []).map((o) => ({
        id: o.id, name: o.name, legalName: o.legal_name ?? undefined,
        onboardingStatus: o.onboarding_status ?? 'active', createdAt: o.created_at,
      }));
      res.status(200).json({ ok: true, isAdmin: true, merchants });
    });

    app.post('/api/admin/merchants/:id/status', async (req, res) => {
      const admin = await authoriseAdmin(req);
      if (!admin) { res.status(403).json({ ok: false, error: 'Forbidden' }); return; }
      const status = (req.body as { status?: string })?.status;
      if (!['active', 'pending_review', 'suspended'].includes(status ?? '')) { res.status(400).json({ ok: false, error: 'Invalid status' }); return; }
      const { error } = await db.from('organizations').update({ onboarding_status: status }).eq('id', req.params.id);
      orgCache.delete(req.params.id); // so the suspended-block check reflects the change
      if (error) { res.status(500).json({ ok: false, error: error.message }); return; }
      await audit(req.params.id, 'merchant.status', { actor: 'admin:' + admin.email, resource: 'organizations', resourceId: req.params.id, operation: 'update', details: { status } });
      res.status(200).json({ ok: true });
    });

    // ── Per-tenant integrations: connect your own HubSpot / Instagram ──
    app.get('/api/integrations', async (req, res) => {
      const op = await authoriseOperator(req);
      if (!op) { res.status(401).json({ ok: false, error: 'Unauthorized' }); return; }
      const hs = await store.getIntegrationConnection(op.organizationId, 'hubspot').catch(() => null);
      const ig = await store.getIntegrationConnection(op.organizationId, 'instagram').catch(() => null);
      const gs = await store.getIntegrationConnection(op.organizationId, 'google_sheets').catch(() => null);
      res.status(200).json({
        ok: true,
        hubspot: { connected: hs?.status === 'active' },
        instagram: { connected: ig?.status === 'active', pageId: ig?.config['pageId'] as string | undefined },
        googleSheets: {
          connected: gs?.status === 'active',
          // The address merchants must share their spreadsheet with (Editor).
          serviceAccountEmail: sheets.serviceAccountEmail,
          available: sheets.isConfigured,
          spreadsheetId: gs?.config['spreadsheetId'] as string | undefined,
          spreadsheetUrl: gs?.config['spreadsheetUrl'] as string | undefined,
          title: gs?.config['title'] as string | undefined,
          leadsTab: (gs?.config['leadsTab'] as string | undefined) ?? 'Leads',
          contactsTab: (gs?.config['contactsTab'] as string | undefined) ?? 'Contacts',
          reportsTab: (gs?.config['reportsTab'] as string | undefined) ?? 'Reports',
          syncLeads: gs?.config['syncLeads'] !== false,
        },
      });
    });

    app.post('/api/integrations/hubspot', async (req, res) => {
      const op = await authoriseOperator(req);
      if (!op) { res.status(401).json({ ok: false, error: 'Unauthorized' }); return; }
      const b = (req.body ?? {}) as { accessToken?: string; webhookSecret?: string };
      const accessToken = (b.accessToken ?? '').trim();
      if (!accessToken) { res.status(400).json({ ok: false, error: 'HubSpot private-app token is required' }); return; }
      try {
        const probe = await fetch('https://api.hubapi.com/crm/v3/objects/contacts?limit=1', { headers: { Authorization: `Bearer ${accessToken}` } });
        if (probe.status === 401) { res.status(400).json({ ok: false, error: 'HubSpot rejected that token (401). Check the private-app token.' }); return; }
      } catch { /* network hiccup — save anyway */ }
      await store.saveIntegrationConnection(op.organizationId, 'hubspot', { config: { accessToken, webhookSecret: (b.webhookSecret ?? '').trim() || undefined }, secretKeys: ['accessToken', 'webhookSecret'], status: 'active' });
      hubspotCache.delete(op.organizationId);
      await audit(op.organizationId, 'integration.connect', { actor: 'user:' + op.userId, resource: 'integration_connections', resourceId: 'hubspot', operation: 'update' });
      res.status(200).json({ ok: true });
    });

    app.post('/api/integrations/instagram', async (req, res) => {
      const op = await authoriseOperator(req);
      if (!op) { res.status(401).json({ ok: false, error: 'Unauthorized' }); return; }
      const b = (req.body ?? {}) as { pageId?: string; pageAccessToken?: string; verifyToken?: string };
      const pageId = (b.pageId ?? '').trim();
      const pageAccessToken = (b.pageAccessToken ?? '').trim();
      if (!pageId || !pageAccessToken) { res.status(400).json({ ok: false, error: 'Page ID and access token are required' }); return; }
      await store.saveIntegrationConnection(op.organizationId, 'instagram', { config: { pageId, pageAccessToken, verifyToken: (b.verifyToken ?? '').trim() || verifyToken }, secretKeys: ['pageAccessToken'], status: 'active' });
      await audit(op.organizationId, 'integration.connect', { actor: 'user:' + op.userId, resource: 'integration_connections', resourceId: 'instagram', operation: 'update' });
      res.status(200).json({ ok: true });
    });

    // Connect a Google Sheet: the merchant pastes the sheet URL after sharing it
    // with our service account. We verify access (read title/tabs), then store
    // the id + tab prefs. No secrets — auth is the platform service account.
    app.post('/api/integrations/google_sheets', async (req, res) => {
      const op = await authoriseOperator(req);
      if (!op) { res.status(401).json({ ok: false, error: 'Unauthorized' }); return; }
      if (!sheets.isConfigured) { res.status(503).json({ ok: false, error: 'Google Sheets is not configured on this server (missing service account).' }); return; }
      const b = (req.body ?? {}) as { spreadsheetUrl?: string; leadsTab?: string; contactsTab?: string; reportsTab?: string; syncLeads?: boolean };
      const spreadsheetId = parseSpreadsheetId(b.spreadsheetUrl ?? '');
      if (!spreadsheetId) { res.status(400).json({ ok: false, error: 'Paste a valid Google Sheets link.' }); return; }
      let title = 'Untitled';
      try {
        const meta = await sheets.getMeta(spreadsheetId);
        title = meta.title;
      } catch (err) {
        res.status(400).json({ ok: false, error: err instanceof Error ? err.message : 'Could not open that spreadsheet.' });
        return;
      }
      await store.saveIntegrationConnection(op.organizationId, 'google_sheets', {
        config: {
          spreadsheetId,
          spreadsheetUrl: (b.spreadsheetUrl ?? '').trim(),
          title,
          leadsTab: (b.leadsTab ?? '').trim() || 'Leads',
          contactsTab: (b.contactsTab ?? '').trim() || 'Contacts',
          reportsTab: (b.reportsTab ?? '').trim() || 'Reports',
          syncLeads: b.syncLeads !== false,
        },
        status: 'active',
      });
      sheetConfigCache.delete(op.organizationId);
      await audit(op.organizationId, 'integration.connect', { actor: 'user:' + op.userId, resource: 'integration_connections', resourceId: 'google_sheets', operation: 'update', details: { spreadsheetId, title } });
      res.status(200).json({ ok: true, title });
    });

    app.delete('/api/integrations/:provider', async (req, res) => {
      const op = await authoriseOperator(req);
      if (!op) { res.status(401).json({ ok: false, error: 'Unauthorized' }); return; }
      const provider = req.params.provider;
      if (!['hubspot', 'instagram', 'google_sheets'].includes(provider)) { res.status(400).json({ ok: false, error: 'Unknown provider' }); return; }
      await store.saveIntegrationConnection(op.organizationId, provider, { config: {}, status: 'inactive' });
      if (provider === 'hubspot') hubspotCache.delete(op.organizationId);
      if (provider === 'google_sheets') sheetConfigCache.delete(op.organizationId);
      await audit(op.organizationId, 'integration.disconnect', { actor: 'user:' + op.userId, resource: 'integration_connections', resourceId: provider, operation: 'update' });
      res.status(200).json({ ok: true });
    });

    // ── Use case 2: Bulk messaging — broadcast an approved WhatsApp template to
    // a Google Sheet of contacts. Business-initiated messages require an approved
    // template. Runs in the background; poll GET /api/broadcasts for status.
    const BROADCAST_MAX = 500; // per-run cap (serverless time budget); larger lists need batching
    function pickField(row: Record<string, string>, keys: string[]): string {
      for (const k of keys) { const v = row[k]; if (v) return v; }
      return '';
    }
    app.post('/api/broadcast', async (req, res) => {
      const op = await authoriseOperator(req);
      if (!op) { res.status(401).json({ ok: false, error: 'Unauthorized' }); return; }
      if (!sheets.isConfigured) { res.status(503).json({ ok: false, error: 'Google Sheets is not configured on this server.' }); return; }
      const cfg = await sheetConfigForOrg(op.organizationId);
      if (!cfg) { res.status(400).json({ ok: false, error: 'Connect a Google Sheet first.' }); return; }
      const b = (req.body ?? {}) as { templateKey?: string; tab?: string; limit?: number };
      const templateKey = (b.templateKey ?? '').trim() || (env['REENGAGEMENT_TEMPLATE'] ?? 'hello_world');
      const tab = (b.tab ?? '').trim() || cfg.contactsTab;

      let rows: Record<string, string>[];
      try {
        rows = await sheets.readAsObjects(cfg.spreadsheetId, tab);
      } catch (err) {
        res.status(400).json({ ok: false, error: err instanceof Error ? err.message : 'Could not read the contacts tab.' });
        return;
      }
      const recipients = rows
        .map((r) => ({
          phone: pickField(r, ['phone', 'phone number', 'whatsapp', 'mobile', 'number', 'contact']),
          name: pickField(r, ['name', 'first name', 'full name', 'customer']),
        }))
        .filter((r) => r.phone);
      if (recipients.length === 0) { res.status(400).json({ ok: false, error: `No phone numbers found in "${tab}". Add a "Phone" column.` }); return; }

      const requested = recipients.length;
      const cap = Math.min(BROADCAST_MAX, b.limit && b.limit > 0 ? b.limit : BROADCAST_MAX);
      const targets = recipients.slice(0, cap);

      const { data: bc } = await tenantDb(op.organizationId).from('broadcasts').insert({
        template_key: templateKey,
        source: `google_sheets:${tab}`,
        status: 'running',
        total: targets.length,
        started_by: 'user:' + op.userId,
      }).select('id').maybeSingle();
      const broadcastId = (bc as { id?: string } | null)?.id;
      await audit(op.organizationId, 'broadcast.start', { actor: 'user:' + op.userId, resource: 'broadcasts', resourceId: broadcastId, operation: 'insert', details: { templateKey, total: targets.length, tab } });

      // Send off the reply path so the request returns immediately.
      const run = (async () => {
        const orgAdapter = await adapterForOrg(op.organizationId);
        const runId = broadcastId ?? `bc-${Date.now()}`;
        let sent = 0; const errors: { phone: string; error: string }[] = [];
        for (const r of targets) {
          try {
            const sr = await orgAdapter.sendMessage(op.organizationId, {
              to: r.phone, type: 'template', templateKey,
              templateParams: { name: r.name || 'there' },
              text: `Hi ${r.name || 'there'}!`,
              idempotencyKey: `broadcast:${runId}:${r.phone}`,
            });
            if (sr.success) sent++;
            else errors.push({ phone: r.phone, error: sr.error ?? 'send failed' });
          } catch (err) {
            errors.push({ phone: r.phone, error: err instanceof Error ? err.message : String(err) });
          }
        }
        const failed = targets.length - sent;
        if (broadcastId) {
          await tenantDb(op.organizationId).from('broadcasts').update({
            status: 'completed', sent, failed, errors: errors.slice(0, 50), completed_at: new Date().toISOString(),
          }).eq('id', broadcastId);
        }
        // Use case 3 overlap: log the run to the report tab (best-effort).
        try {
          await sheets.ensureHeader(cfg.spreadsheetId, cfg.reportsTab, ['Timestamp', 'Report', 'Detail', 'Value']);
          await sheets.appendRows(cfg.spreadsheetId, cfg.reportsTab, [[
            new Date().toISOString(), 'Broadcast', templateKey,
            `${sent}/${targets.length} sent${failed ? `, ${failed} failed` : ''}`,
          ]]);
        } catch { /* reporting is best-effort */ }
        logger.info('Broadcast complete', { orgId: op.organizationId, broadcastId, sent, failed });
      })();
      try { waitUntil(run); } catch { void run; }

      res.status(202).json({ ok: true, broadcastId, total: targets.length, requested, truncated: requested > targets.length });
    });

    app.get('/api/broadcasts', async (req, res) => {
      const op = await authoriseOperator(req);
      if (!op) { res.status(401).json({ ok: false, error: 'Unauthorized' }); return; }
      const { data } = await tenantDb(op.organizationId).from('broadcasts')
        .select('id, template_key, source, status, total, sent, failed, created_at, completed_at')
        .order('created_at', { ascending: false }).limit(20);
      res.status(200).json({ ok: true, broadcasts: data ?? [] });
    });

    // ── Use case 3: Reporting — export current analytics to the report tab. ──
    app.post('/api/integrations/google_sheets/export', async (req, res) => {
      const op = await authoriseOperator(req);
      if (!op) { res.status(401).json({ ok: false, error: 'Unauthorized' }); return; }
      if (!sheets.isConfigured) { res.status(503).json({ ok: false, error: 'Google Sheets is not configured on this server.' }); return; }
      const cfg = await sheetConfigForOrg(op.organizationId);
      if (!cfg) { res.status(400).json({ ok: false, error: 'Connect a Google Sheet first.' }); return; }
      try {
        const s = await store.getBusinessSummary(op.organizationId, new Date());
        const ts = new Date().toISOString();
        const rows: (string | number)[][] = [
          [ts, 'Analytics', 'Today enquiries', s.todayEnquiries],
          [ts, 'Analytics', 'Qualified leads', s.qualifiedLeads],
          [ts, 'Analytics', 'Hot leads', s.hotLeads],
          [ts, 'Analytics', 'Stale leads', s.staleLeads],
          [ts, 'Analytics', 'Pending payments', s.pendingPayments],
          [ts, 'Analytics', 'Pipeline value', s.pipelineText],
        ];
        await sheets.ensureHeader(cfg.spreadsheetId, cfg.reportsTab, ['Timestamp', 'Report', 'Detail', 'Value']);
        await sheets.appendRows(cfg.spreadsheetId, cfg.reportsTab, rows);
        await audit(op.organizationId, 'sheets.export', { actor: 'user:' + op.userId, resource: 'google_sheets', resourceId: cfg.spreadsheetId, operation: 'insert', details: { rows: rows.length } });
        res.status(200).json({ ok: true, exported: rows.length, tab: cfg.reportsTab });
      } catch (err) {
        res.status(400).json({ ok: false, error: err instanceof Error ? err.message : 'Export failed.' });
      }
    });

    // ═══ Data-driven marketing: campaigns + segmentation + real analytics ═══

    // Preview a segment: how many reachable contacts match + a small name sample.
    app.post('/api/segments/preview', async (req, res) => {
      const op = await authoriseOperator(req);
      if (!op) { res.status(401).json({ ok: false, error: 'Unauthorized' }); return; }
      const b = (req.body ?? {}) as { filter?: unknown; channel?: string };
      const channel = b.channel === 'email' ? 'email' : 'whatsapp';
      const audience = await resolveAudience(op.organizationId, normalizeFilter(b.filter), channel);
      res.status(200).json({ ok: true, count: audience.length, sample: audience.slice(0, 5).map((a) => a.name || a.email || a.phone) });
    });

    app.get('/api/segments', async (req, res) => {
      const op = await authoriseOperator(req);
      if (!op) { res.status(401).json({ ok: false, error: 'Unauthorized' }); return; }
      const { data } = await tenantDb(op.organizationId).from('segments').select('id, name, filters, created_at').order('created_at', { ascending: false }).limit(50);
      res.status(200).json({ ok: true, segments: data ?? [] });
    });

    app.post('/api/segments', async (req, res) => {
      const op = await authoriseOperator(req);
      if (!op) { res.status(401).json({ ok: false, error: 'Unauthorized' }); return; }
      const b = (req.body ?? {}) as { name?: string; filter?: unknown };
      const name = (b.name ?? '').trim();
      if (!name) { res.status(400).json({ ok: false, error: 'Segment name is required' }); return; }
      const { data } = await tenantDb(op.organizationId).from('segments').insert({ name, filters: normalizeFilter(b.filter) }).select('id').maybeSingle();
      await audit(op.organizationId, 'segment.create', { actor: 'user:' + op.userId, resource: 'segments', resourceId: (data as { id?: string } | null)?.id, operation: 'insert' });
      res.status(200).json({ ok: true, id: (data as { id?: string } | null)?.id });
    });

    // Create + send a campaign (WhatsApp template or Email). Runs in background.
    app.post('/api/campaigns', async (req, res) => {
      const op = await authoriseOperator(req);
      if (!op) { res.status(401).json({ ok: false, error: 'Unauthorized' }); return; }
      const b = (req.body ?? {}) as { name?: string; channel?: string; filter?: unknown; templateKey?: string; emailSubject?: string; emailHtml?: string; targetUrl?: string };
      const name = (b.name ?? '').trim();
      const channel = b.channel === 'email' ? 'email' : 'whatsapp';
      if (!name) { res.status(400).json({ ok: false, error: 'Campaign name is required' }); return; }
      if (channel === 'email') {
        if (!emailService.isConfigured) { res.status(503).json({ ok: false, error: 'Email is not configured on this server.' }); return; }
        if (!(b.emailSubject ?? '').trim() || !(b.emailHtml ?? '').trim()) { res.status(400).json({ ok: false, error: 'Email subject and body are required' }); return; }
      }
      const filter = normalizeFilter(b.filter);
      const { data: camp } = await tenantDb(op.organizationId).from('campaigns').insert({
        name, channel, status: 'sending', audience: filter,
        template_key: channel === 'whatsapp' ? ((b.templateKey ?? '').trim() || env['REENGAGEMENT_TEMPLATE'] || 'hello_world') : null,
        email_subject: channel === 'email' ? (b.emailSubject ?? '').trim() : null,
        email_html: channel === 'email' ? (b.emailHtml ?? '') : null,
        target_url: (b.targetUrl ?? '').trim() || null,
        started_by: 'user:' + op.userId,
      }).select('id, channel, template_key, email_subject, email_html, target_url, sent_at').maybeSingle();
      const campaign = camp as CampaignRow | null;
      if (!campaign) { res.status(500).json({ ok: false, error: 'Could not create campaign' }); return; }
      await audit(op.organizationId, 'campaign.send', { actor: 'user:' + op.userId, resource: 'campaigns', resourceId: campaign.id, operation: 'insert', details: { channel, name } });
      const work = (async () => {
        try {
          const audience = await resolveAudience(op.organizationId, filter, channel);
          if (audience.length === 0) { await tenantDb(op.organizationId).from('campaigns').update({ status: 'sent', total: 0, completed_at: new Date().toISOString() }).eq('id', campaign.id); return; }
          await runCampaign(op.organizationId, campaign, audience);
        } catch (err) {
          logger.error('Campaign run failed', { campaignId: campaign.id }, err instanceof Error ? err : new Error(String(err)));
          try { await tenantDb(op.organizationId).from('campaigns').update({ status: 'failed' }).eq('id', campaign.id); } catch { /* ignore */ }
        }
      })();
      try { waitUntil(work); } catch { void work; }
      res.status(202).json({ ok: true, campaignId: campaign.id });
    });

    app.get('/api/campaigns', async (req, res) => {
      const op = await authoriseOperator(req);
      if (!op) { res.status(401).json({ ok: false, error: 'Unauthorized' }); return; }
      const { data } = await tenantDb(op.organizationId).from('campaigns').select('id, name, channel, status, total, sent, failed, created_at, sent_at, completed_at').order('created_at', { ascending: false }).limit(50);
      res.status(200).json({ ok: true, campaigns: data ?? [] });
    });

    // Campaign detail with REAL computed analytics (from recipient tracking).
    app.get('/api/campaigns/:id', async (req, res) => {
      const op = await authoriseOperator(req);
      if (!op) { res.status(401).json({ ok: false, error: 'Unauthorized' }); return; }
      const { data: camp } = await tenantDb(op.organizationId).from('campaigns').select('id, name, channel, status, total, sent, failed, target_url, created_at, sent_at, completed_at').eq('id', req.params.id).maybeSingle();
      if (!camp) { res.status(404).json({ ok: false, error: 'Not found' }); return; }
      const { data: rcpts } = await tenantDb(op.organizationId).from('campaign_recipients').select('status, delivered_at, opened_at, clicked_at, converted_at').eq('campaign_id', req.params.id).limit(5000);
      res.status(200).json({ ok: true, campaign: camp, stats: computeStats(rcpts ?? []) });
    });

    // Marketing overview: aggregate metrics + top engaged contacts.
    app.get('/api/marketing/overview', async (req, res) => {
      const op = await authoriseOperator(req);
      if (!op) { res.status(401).json({ ok: false, error: 'Unauthorized' }); return; }
      const { data: rcpts } = await tenantDb(op.organizationId).from('campaign_recipients').select('contact_id, status, delivered_at, opened_at, clicked_at, converted_at, created_at').limit(5000);
      const rows = (rcpts ?? []) as Array<{ contact_id?: string; status: string; delivered_at?: string | null; opened_at?: string | null; clicked_at?: string | null; converted_at?: string | null; created_at?: string }>;
      const byC = new Map<string, { opens: number; clicks: number; conversions: number; last: number }>();
      for (const r of rows) {
        if (!r.contact_id) continue;
        const e = byC.get(r.contact_id) ?? { opens: 0, clicks: 0, conversions: 0, last: 0 };
        if (r.opened_at) e.opens++;
        if (r.clicked_at) e.clicks++;
        if (r.converted_at) e.conversions++;
        const t = Date.parse(r.opened_at ?? r.clicked_at ?? r.created_at ?? '');
        if (!Number.isNaN(t)) e.last = Math.max(e.last, t);
        byC.set(r.contact_id, e);
      }
      const top = [...byC.entries()]
        .map(([contactId, e]) => ({ contactId, score: engagementScore({ opens: e.opens, clicks: e.clicks, conversions: e.conversions, inboundMessages: 0, daysSinceLastActivity: e.last ? Math.floor((Date.now() - e.last) / 86_400_000) : null }) }))
        .sort((a, b) => b.score - a.score).slice(0, 10);
      const names = new Map<string, string>();
      if (top.length) {
        const { data: cs } = await tenantDb(op.organizationId).from('contacts').select('id, name').in('id', top.map((t) => t.contactId));
        for (const c of (cs ?? []) as Array<{ id: string; name?: string }>) names.set(c.id, c.name ?? '');
      }
      res.status(200).json({ ok: true, stats: computeStats(rows), topContacts: top.map((t) => ({ ...t, name: names.get(t.contactId) ?? '' })) });
    });

    // Public tracked-link redirect → records the click, then 302s to the target.
    app.get('/r/:token', async (req, res) => {
      const p = verifyTrack(trackSecret, req.params.token);
      if (!p) { res.status(400).send('Invalid or expired link'); return; }
      const work = (async () => {
        try {
          const nowIso = new Date().toISOString();
          const { data } = await db.from('campaign_recipients').select('click_count, opened_at').eq('id', p.r).maybeSingle();
          const cur = data as { click_count?: number; opened_at?: string | null } | null;
          await db.from('campaign_recipients').update({ clicked_at: nowIso, opened_at: cur?.opened_at ?? nowIso, click_count: (cur?.click_count ?? 0) + 1, updated_at: nowIso }).eq('id', p.r);
        } catch { /* tracking is best-effort — never block the redirect */ }
      })();
      try { waitUntil(work); } catch { void work; }
      res.redirect(302, p.u);
    });

    // Resend email events (delivered/opened/clicked) → recipient tracking.
    app.post('/webhooks/resend', async (req, res) => {
      // Verify the Svix signature when a secret is configured.
      const secret = env['RESEND_WEBHOOK_SECRET'];
      if (secret) {
        const raw = (req as express.Request & { rawBody?: Buffer }).rawBody;
        const svixId = req.headers['svix-id'] as string | undefined;
        const svixTs = req.headers['svix-timestamp'] as string | undefined;
        const svixSig = req.headers['svix-signature'] as string | undefined;
        let ok = false;
        if (raw && svixId && svixTs && svixSig) {
          try {
            const { createHmac: hmacFn } = await import('crypto');
            const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
            const expected = hmacFn('sha256', key).update(`${svixId}.${svixTs}.${raw.toString('utf8')}`).digest('base64');
            ok = svixSig.split(' ').some((part) => part.split(',')[1] === expected);
          } catch { ok = false; }
        }
        if (!ok) { res.status(401).json({ error: 'Invalid signature' }); return; }
      }
      res.status(200).json({ received: true });
      try {
        const body = req.body as { type?: string; data?: { email_id?: string } };
        const id = body.data?.email_id;
        if (!id || !body.type) return;
        const nowIso = new Date().toISOString();
        if (body.type === 'email.opened') {
          await db.from('campaign_recipients').update({ opened_at: nowIso, status: 'opened', updated_at: nowIso }).eq('provider_message_id', id).is('opened_at', null);
        } else if (body.type === 'email.clicked') {
          const { data } = await db.from('campaign_recipients').select('click_count, opened_at').eq('provider_message_id', id).maybeSingle();
          const cur = data as { click_count?: number; opened_at?: string | null } | null;
          await db.from('campaign_recipients').update({ clicked_at: nowIso, opened_at: cur?.opened_at ?? nowIso, click_count: (cur?.click_count ?? 0) + 1, updated_at: nowIso }).eq('provider_message_id', id);
        } else if (body.type === 'email.delivered') {
          await db.from('campaign_recipients').update({ delivered_at: nowIso, updated_at: nowIso }).eq('provider_message_id', id).in('status', ['sent', 'queued']);
        } else if (body.type === 'email.bounced' || body.type === 'email.complained') {
          await db.from('campaign_recipients').update({ status: 'failed', error: body.type, updated_at: nowIso }).eq('provider_message_id', id);
        }
      } catch (err) {
        logger.warn('Resend webhook error', { error: err instanceof Error ? err.message : String(err) });
      }
    });

    /** Platform billing — create a Stripe checkout session for a plan. */
    app.post('/api/billing/checkout', async (req, res) => {
      const operator = await authoriseOperator(req);
      if (!operator) { res.status(401).json({ ok: false, error: 'Unauthorized' }); return; }
      const plan = (req.body as { plan?: string })?.plan;
      const planDef = PLANS.find((p) => p.id === plan);
      if (!planDef) { res.status(400).json({ ok: false, error: 'Unknown plan' }); return; }
      if (!billing.isConfigured) { res.status(200).json({ ok: false, error: "Billing isn't enabled yet — add STRIPE_SECRET_KEY." }); return; }
      const priceId = env[planDef.priceEnvVar];
      if (!priceId) { res.status(200).json({ ok: false, error: `Price not configured (${planDef.priceEnvVar}).` }); return; }
      const base = env['DASHBOARD_URL'] ?? 'https://saarthione.vercel.app';
      const result = await billing.createCheckoutSession({
        organizationId: operator.organizationId, priceId,
        successUrl: `${base}/?billing=success`, cancelUrl: `${base}/?billing=cancel`,
      });
      res.status(200).json(result);
    });

    /** Stripe webhook — activate/deactivate the org's plan on subscription events. */
    app.post('/webhooks/stripe', async (req, res) => {
      const sig = req.headers['stripe-signature'];
      const raw = (req as express.Request & { rawBody?: Buffer }).rawBody;
      if (!raw || typeof sig !== 'string' || !billing.verifyWebhookSignature(raw, sig)) {
        res.status(401).json({ error: 'Invalid signature' }); return;
      }
      const event = await billing.parseWebhookEvent(raw.toString('utf8'));
      if (event?.organizationId) {
        const active = event.type !== 'customer.subscription.deleted';
        await db.from('organizations').update({
          subscription_status: event.status ?? (active ? 'active' : 'canceled'),
          stripe_customer_id: event.customerId ?? undefined,
          plan: active ? 'paid' : 'free',
        }).eq('id', event.organizationId);
      }
      res.status(200).json({ received: true });
    });

    /** GDPR — export all data held for a customer (by phone), for the org. */
    app.post('/api/data/export', async (req, res) => {
      const operator = await authoriseOperator(req);
      if (!operator) { res.status(401).json({ error: 'Unauthorized' }); return; }
      const phone = (req.body as { phone?: string })?.phone;
      if (!phone) { res.status(400).json({ error: 'phone required' }); return; }
      const org = operator.organizationId;
      const norm = phone.startsWith('+') ? phone : `+${phone}`;
      // Look up via the blind index (phone_number is masked/encrypted at rest).
      const found = await store.findContactByPhone(org, norm);
      const { data: contact } = found
        ? await tenantDb(org).from('contacts').select('*').eq('id', found.id).maybeSingle()
        : { data: null };
      if (!contact) { res.status(404).json({ error: 'No data for that number' }); return; }
      const cid = contact.id;
      const [consent, leads, bookings, handoffs, convs] = await Promise.all([
        tenantDb(org).from('consent_records').select('*').eq('contact_id', cid),
        tenantDb(org).from('leads').select('*').eq('contact_id', cid),
        tenantDb(org).from('bookings').select('*').eq('contact_id', cid),
        tenantDb(org).from('handoffs').select('*').eq('contact_id', cid),
        tenantDb(org).from('conversations').select('id').eq('contact_id', cid),
      ]);
      const convIds = (convs.data ?? []).map((c: { id: string }) => c.id);
      const messages = convIds.length ? (await tenantDb(org).from('messages').select('direction, content, created_at').in('conversation_id', convIds)).data : [];
      await audit(org, 'data.export', { actor: 'user:' + operator.userId, resource: 'contacts', resourceId: found?.id });
      res.status(200).json({ contact, consent: consent.data, leads: leads.data, bookings: bookings.data, handoffs: handoffs.data, messages });
    });

    /** GDPR — delete/erase all data held for a customer (by phone). */
    app.post('/api/data/delete', async (req, res) => {
      const operator = await authoriseOperator(req);
      if (!operator) { res.status(401).json({ error: 'Unauthorized' }); return; }
      const phone = (req.body as { phone?: string })?.phone;
      if (!phone) { res.status(400).json({ error: 'phone required' }); return; }
      const org = operator.organizationId;
      const norm = phone.startsWith('+') ? phone : `+${phone}`;
      const found = await store.findContactByPhone(org, norm);
      const contact = found ? { id: found.id } : null;
      if (!contact) { res.status(404).json({ error: 'No data for that number' }); return; }
      // Deleting the contact cascades to consent/conversations/messages/leads/bookings/handoffs.
      await tenantDb(org).from('contacts').delete().eq('id', contact.id);
      await store.insertAuditEvent({ id: randomUUID(), organizationId: org, action: 'gdpr_erasure', entityType: 'contact', entityId: contact.id, actorType: 'user', details: { by: operator.userId }, createdAt: new Date().toISOString() });
      await audit(org, 'data.delete', { actor: 'user:' + operator.userId, resource: 'contacts', resourceId: contact.id, operation: 'delete' });
      res.status(200).json({ ok: true, erased: true });
    });

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
        // Booking paid → confirm on WhatsApp (off the response path).
        if (result.bookingConfirmed && result.orderId && result.organizationId) {
          const work = sendBookingConfirmation(result.organizationId, result.orderId);
          try { waitUntil(work); } catch { void work; }
        }
        res.status(200).json(result);
      } catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
      }
    });

    /**
     * Per-merchant Razorpay webhook. Each merchant points their own Razorpay
     * webhook (with their own secret) at /webhooks/razorpay/<their org id>, so
     * the signature is verified against THAT merchant's webhook secret.
     */
    app.post('/webhooks/razorpay/:orgId', async (req, res) => {
      const orgId = req.params.orgId;
      const svc = await razorpayForOrg(orgId);
      if (!svc) { res.status(503).json({ error: 'No payment connection for this merchant' }); return; }
      const signature = req.headers['x-razorpay-signature'];
      const rawBody = (req as express.Request & { rawBody?: Buffer }).rawBody;
      if (!rawBody || typeof signature !== 'string' || !svc.verifyWebhookSignature(rawBody, signature)) {
        logger.warn('Razorpay per-merchant webhook rejected: invalid signature', { orgId });
        res.status(401).json({ error: 'Invalid signature' });
        return;
      }
      try {
        const result = await svc.handleWebhookEvent(req.body);
        if (result.bookingConfirmed && result.orderId && result.organizationId) {
          const work = sendBookingConfirmation(result.organizationId, result.orderId);
          try { waitUntil(work); } catch { void work; }
        }
        res.status(200).json(result);
      } catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
      }
    });
    /**
     * HubSpot webhook — inbound half of the two-way sync. When a contact's
     * property changes in HubSpot (email, name, phone), mirror it back onto the
     * SaarthiOne contact we linked via hubspot_contact_id.
     */
    app.post('/webhooks/hubspot', async (req, res) => {
      const raw = (req as express.Request & { rawBody?: Buffer }).rawBody;
      const sig = req.headers['x-hubspot-signature-v3'];
      const ts = req.headers['x-hubspot-request-timestamp'];
      if (!raw || typeof sig !== 'string' || typeof ts !== 'string') {
        res.status(401).json({ error: 'Missing signature' }); return;
      }
      const ok = hubspot.verifyWebhookSignature({
        method: 'POST', uri: `${publicBaseUrl}${req.originalUrl}`,
        body: raw.toString('utf8'), signature: sig, timestamp: ts,
      });
      if (!ok) { res.status(401).json({ error: 'Invalid signature' }); return; }

      const events = hubspot.parseWebhookEvents(raw.toString('utf8'));
      for (const ev of events) {
        if (ev.objectType !== 'contact' || !ev.propertyName) continue;
        const col = ev.propertyName === 'email' ? 'email'
          : ev.propertyName === 'firstname' || ev.propertyName === 'lastname' ? 'name'
          : null;
        if (!col || ev.propertyValue == null) continue;
        // Match our contact by the HubSpot object id we stored on push.
        const patch: Record<string, string> = {};
        if (col === 'email') patch['email'] = ev.propertyValue;
        else patch['name'] = ev.propertyValue; // best-effort: full/first name
        const { data } = await db.from('contacts')
          .update(patch).eq('hubspot_contact_id', String(ev.objectId)).select('id, organization_id');
        if (data && data.length > 0) {
          logger.info('Contact updated from HubSpot', { property: ev.propertyName, count: data.length });
        }
      }
      res.status(200).json({ received: true, processed: events.length });
    });

    // ── Instagram Direct / Messenger webhook (shares the WhatsApp agent pipeline) ──
    // Instagram/Messenger webhook — registered whether or not the platform env
    // adapter exists, so per-merchant connections (integration_connections) work.
    app.get('/webhooks/instagram', async (req, res) => {
      const token = String(req.query['hub.verify_token'] ?? '');
      const challenge = String(req.query['hub.challenge'] ?? '');
      let ok = !!token && (token === verifyToken || token === (env['INSTAGRAM_VERIFY_TOKEN'] ?? ''));
      if (!ok && token) {
        const { data } = await db.from('integration_connections').select('id').eq('provider', 'instagram').eq('status', 'active').filter('config->>verifyToken', 'eq', token).limit(1);
        ok = !!(data && data.length);
      }
      if (ok && challenge) res.status(200).send(challenge);
      else res.status(403).send('Forbidden');
    });

    app.post('/webhooks/instagram', async (req, res) => {
      // Meta signs IG/Messenger webhooks with the app secret (same as WhatsApp).
      const raw = (req as express.Request & { rawBody?: Buffer }).rawBody;
      const sig = req.headers['x-hub-signature-256'];
      const appSecret = env['META_APP_SECRET'];
      if (appSecret) {
        const { createHmac } = await import('crypto');
        const expected = 'sha256=' + createHmac('sha256', appSecret).update(raw ?? Buffer.from('')).digest('hex');
        if (typeof sig !== 'string' || sig !== expected) { res.status(401).json({ error: 'Invalid signature' }); return; }
      }
      res.status(200).json({ received: true }); // Meta requires a fast 200
      // Route to the merchant that owns this page (else the platform default).
      const pageId = (req.body as { entry?: Array<{ id?: string }> })?.entry?.[0]?.id;
      const resolved = await instagramForPage(pageId);
      if (!resolved) return;
      const messages = resolved.adapter.parseInboundEvent(req.body);
      if (messages.length === 0) return;
      const work = ingestInboundMessages(messages, resolved.adapter, resolved.orgId);
      try { waitUntil(work); } catch { void work; }
    });

    /** Readiness — liveness + DB reachability for uptime monitors (public, no secrets). */
    app.get('/health/ready', async (_req, res) => {
      const t = Date.now();
      let dbOk = false;
      try { const { error } = await db.from('organizations').select('id').limit(1); dbOk = !error; } catch { dbOk = false; }
      res.status(dbOk ? 200 : 503).json({
        status: dbOk ? 'ok' : 'degraded', db: dbOk, whatsapp: activeProvider,
        embeddings: !!embedder, ts: new Date().toISOString(), latencyMs: Date.now() - t,
      });
    });

    // ── Team invites (real): create → email → accept ──────────────────
    app.post('/api/team/invite', async (req, res) => {
      const operator = await authoriseOperator(req);
      if (!operator) { res.status(401).json({ ok: false, error: 'Unauthorized' }); return; }
      const email = (req.body as { email?: string })?.email?.trim().toLowerCase();
      const role = (req.body as { role?: string })?.role === 'admin' ? 'admin' : 'operator';
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { res.status(400).json({ ok: false, error: 'A valid email is required' }); return; }
      const token = (randomUUID() + randomUUID()).replace(/-/g, '');
      const { data, error } = await db.from('team_invites').upsert({
        organization_id: operator.organizationId, email, role, token, invited_by: operator.userId, status: 'pending', accepted_at: null,
      }, { onConflict: 'organization_id,email' }).select('id, email, role, status, created_at').single();
      if (error) { res.status(500).json({ ok: false, error: error.message }); return; }
      const base = env['DASHBOARD_URL'] ?? 'https://saarthione.vercel.app';
      const acceptUrl = `${base}/?invite=${token}`;
      if (emailService.isConfigured) {
        const org = await getOrgContext(operator.organizationId);
        await emailService.send({
          to: email, subject: `You're invited to ${org.name} on SaarthiOne`,
          html: `<p>You've been invited to join <b>${org.name}</b> as <b>${role}</b> on SaarthiOne.</p><p><a href="${acceptUrl}">Accept your invitation</a></p><p style="color:#888;font-size:12px">Or paste this link into your browser: ${acceptUrl}</p>`,
        }).catch(() => { /* invite row still created; email is best-effort */ });
      }
      await audit(operator.organizationId, 'team.invite', { actor: 'user:' + operator.userId, resource: 'team_invites', operation: 'insert', details: { email, role } });
      res.status(200).json({ ok: true, invite: data, acceptUrl });
    });

    app.get('/api/team/invites', async (req, res) => {
      const operator = await authoriseOperator(req);
      if (!operator) { res.status(401).json({ ok: false, error: 'Unauthorized' }); return; }
      const { data } = await tenantDb(operator.organizationId).from('team_invites')
        .select('id, email, role, status, created_at, accepted_at')
        .order('created_at', { ascending: false });
      res.status(200).json({ ok: true, invites: data ?? [] });
    });

    app.post('/api/team/invite/revoke', async (req, res) => {
      const operator = await authoriseOperator(req);
      if (!operator) { res.status(401).json({ ok: false, error: 'Unauthorized' }); return; }
      const id = (req.body as { id?: string })?.id;
      if (!id) { res.status(400).json({ ok: false, error: 'id required' }); return; }
      await tenantDb(operator.organizationId).from('team_invites').update({ status: 'revoked' }).eq('id', id);
      await audit(operator.organizationId, 'team.revoke', { actor: 'user:' + operator.userId, resource: 'team_invites', resourceId: id, operation: 'update' });
      res.status(200).json({ ok: true });
    });

    /** Accept an invite — the signed-in user joins the inviting org. */
    app.post('/api/invite/accept', async (req, res) => {
      const auth = req.headers.authorization;
      if (!auth?.startsWith('Bearer ')) { res.status(401).json({ ok: false, error: 'Sign in to accept the invite' }); return; }
      const user = await verifySupabaseAccessToken({ supabaseUrl: supabaseUrl!, anonKey: anonKey!, accessToken: auth.slice(7) });
      if (!user) { res.status(401).json({ ok: false, error: 'Invalid session' }); return; }
      const token = (req.body as { token?: string })?.token;
      if (!token) { res.status(400).json({ ok: false, error: 'token required' }); return; }
      const { data: invite } = await db.from('team_invites').select('*').eq('token', token).eq('status', 'pending').maybeSingle();
      if (!invite) { res.status(404).json({ ok: false, error: 'This invite is invalid or was already used' }); return; }
      if (user.email && invite.email && user.email.toLowerCase() !== String(invite.email).toLowerCase()) {
        res.status(403).json({ ok: false, error: `This invite is for ${invite.email}. Please sign in with that email.` }); return;
      }
      await db.from('organization_members').upsert({ organization_id: invite.organization_id, user_id: user.userId, role: invite.role }, { onConflict: 'organization_id,user_id' });
      await db.from('team_invites').update({ status: 'accepted', accepted_at: new Date().toISOString() }).eq('id', invite.id);
      await audit(invite.organization_id, 'team.accept', { actor: 'user:' + user.userId, resource: 'organization_members', operation: 'insert' });
      res.status(200).json({ ok: true, organizationId: invite.organization_id, role: invite.role });
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

      const opAdapter = await adapterForOrg(operator.organizationId);
      const result = await opAdapter.sendMessage(operator.organizationId, {
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
        await audit(operator.organizationId, 'operator.message', { actor: 'user:' + operator.userId, resource: 'conversations', resourceId: parsed.data.conversationId });
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
        sendTemplate: async ({ run, contact, templateKey }) => {
          // Automations are business-initiated → use the org's own number + an
          // approved template (24-hour-window compliant).
          const orgAdapter = await adapterForOrg(run.organizationId);
          return orgAdapter.sendMessage(run.organizationId, {
            to: contact.phone,
            type: 'template',
            templateKey,
            templateParams: { name: contact.name ?? 'there' },
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
        whatsappProvider: activeProvider,
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
    // The createApp /webhook route is the Meta channel — reply via Meta.
    // A per-org reply adapter (from Embedded Signup) overrides the default when present.
    onInboundMessage: (orgId, msg, replyAdapter) => handleInbound(orgId, msg, replyAdapter ?? metaAdapter ?? adapter),
    resolveInbound,
    onStatusEvents: applyStatusEvents,
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
    preMiddleware: (req, res, next) => {
      void (async () => {
      const oidc = req.headers['x-vercel-oidc-token'];
      if (typeof oidc === 'string' && oidc.length > 0) {
        process.env['VERCEL_OIDC_TOKEN'] = oidc;
      }
      const ip = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() ?? req.socket.remoteAddress ?? 'unknown';
      // 1) Fast per-instance pre-filter (60 req / 10s per IP) — cheap, no I/O.
      const now = Date.now();
      const win = rateWindows.get(ip);
      if (!win || now > win.reset) {
        rateWindows.set(ip, { count: 1, reset: now + 10_000 });
      } else if (++win.count > 60) {
        res.status(429).json({ error: 'Too many requests' });
        return;
      }
      // 2) Shared, cross-instance limit for state-changing requests (300/min per
      // IP across ALL serverless instances) — the in-memory guard alone can't
      // see a burst spread across instances. Fails open if the RPC is down.
      if (req.method === 'POST' && !req.path.startsWith('/webhook')) {
        try {
          const { data: allowed } = await db.rpc('check_rate_limit', { p_key: `ip:${ip}`, p_max: 300, p_window_seconds: 60 });
          if (allowed === false) { res.status(429).json({ error: 'Rate limit exceeded' }); return; }
        } catch { /* fail open — never block real traffic on a limiter outage */ }
      }
      next();
      })();
    },
  });

  return { app, adapter, db, store, llm, embedder };
}
