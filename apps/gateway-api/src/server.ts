import express from 'express';
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
  ingestMarkdownContent, runOwnerAssistant, isOwnerConfirmation,
  type AgentGraphDeps, type EmbeddingProvider,
} from '@business-os-ai/agent-core';
import { verifySupabaseAccessToken, getOrganizationRole } from '@business-os-ai/auth';
import { RazorpayPaymentService, buildQuotationHtml, buildInvoiceHtml } from '@business-os-ai/commerce';
import {
  createEmailServiceFromEnv, createOcrServiceFromEnv, buildQuotationEmail,
  createBillingServiceFromEnv, PLANS, createHubSpotServiceFromEnv,
} from '@business-os-ai/integrations';
import { SchedulerWorker } from '@business-os-ai/scheduler-worker';
import { logger } from '@business-os-ai/shared-types';
import { waitUntil } from '@vercel/functions';

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
    const { data } = await db.from('whatsapp_connections').select('phone_number_id').eq('organization_id', orgId).eq('status', 'active').maybeSingle();
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

  const publicBaseUrl = (env['PUBLIC_GATEWAY_URL'] ?? 'https://saarthione-api.vercel.app').replace(/\/$/, '');
  const emailService = createEmailServiceFromEnv(env);
  const ocrService = createOcrServiceFromEnv(env);
  const billing = createBillingServiceFromEnv(env);
  const hubspot = createHubSpotServiceFromEnv(env);

  /**
   * Outbound CRM sync: mirror a qualified lead into HubSpot as a contact + deal.
   * Best-effort and non-blocking (called via waitUntil) — never affects the
   * customer reply. Stores the returned HubSpot ids so inbound webhooks can map
   * property changes back to our rows (two-way sync).
   */
  async function syncLeadToHubSpot(orgId: string, leadId: string): Promise<void> {
    if (!hubspot.isConfigured) return;
    try {
      const { data: lead } = await db.from('leads')
        .select('id, contact_id, service_interest, score, stage, estimated_value, hubspot_deal_id')
        .eq('organization_id', orgId).eq('id', leadId).maybeSingle();
      if (!lead?.contact_id) return;
      const { data: contact } = await db.from('contacts')
        .select('id, name, email, phone_number, hubspot_contact_id')
        .eq('organization_id', orgId).eq('id', lead.contact_id).maybeSingle();
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

  function agentDeps(orgId: string, org: { name: string; vertical?: string }): AgentGraphDeps {
    return {
      llm,
      embedder: embedder ?? undefined,
      vectorStore: embedder ? vectorStore : undefined,
      retrievalThreshold: embedder ? PROD_RETRIEVAL_THRESHOLD : undefined,
      vertical: org.vertical,
      businessName: org.name,
      createQuotation: async ({ contactId, packageSku, pricePerPerson, travellers }) => {
        try {
          const { data: pkg } = await db.from('packages').select('id').eq('organization_id', orgId).eq('sku', packageSku).maybeSingle();
          const amount = pricePerPerson * travellers;
          const number = `QT-${Math.floor(100000 + Math.random() * 900000)}`;
          const validUntil = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
          const { data, error } = await db.from('quotes').insert({
            organization_id: orgId, contact_id: contactId, package_id: pkg?.id ?? null,
            quote_number: number, amount, valid_until: validUntil, status: 'sent',
          }).select('id').single();
          if (error || !data) return null;
          const url = `${publicBaseUrl}/doc/quote/${data.id}`;

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
          if (!razorpay) {
            logger.info('Booking reserved; Razorpay not configured — payment link deferred to team', { booking: booking.bookingNumber });
            return null;
          }
          // findContactById returns the REAL phone (decrypted) even though the
          // phone_number column may be masked at rest.
          const contact = await store.findContactById(orgId, contactId);
          const link = await razorpay.createPaymentLink({
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
          if (!razorpay || amount <= 0) return { amountText, bookingNumber: res.bookingNumber };
          const contact = await store.findContactById(orgId, contactId);
          const link = await razorpay.createPaymentLink({
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
          if (!razorpay || amount <= 0) return { amountText, bookingNumber: res.bookingNumber };
          const contact = await store.findContactById(orgId, contactId);
          const link = await razorpay.createPaymentLink({
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

    // ── Document / OCR extraction: customer sent an image or document ──
    if ((msg.type === 'image' || msg.type === 'document') && ocrService.isConfigured) {
      try {
        const meta = (msg.metadata ?? {}) as Record<string, unknown>;
        let image: { imageBase64?: string; mimeType?: string } | null = null;
        if (meta['channel'] === 'meta' && typeof meta['mediaId'] === 'string') {
          const dl = await downloadMetaMedia(meta['mediaId']);
          if (dl) image = { imageBase64: dl.base64, mimeType: dl.mime };
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

    if (!msg.text) {
      logger.info('Skipping non-text inbound message', { providerMessageId: msg.providerMessageId, type: msg.type });
      await idempotencyService.markProcessed(msg.providerMessageId, orgId);
      return;
    }

    try {
      const org = await getOrgContext(orgId);

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
        // If the owner confirms a follow-up ("yes"/"follow up"), actually reach the cold leads.
        if (isOwnerConfirmation(ownerQuestion) && summary.staleContacts.length > 0) {
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
      }

      // Mirror any lead the agent qualified into HubSpot — off the reply path so
      // CRM latency never delays the customer.
      if (hubspot.isConfigured) {
        for (const tc of state.toolCalls) {
          if (tc.tool === 'upsert_qualified_lead') {
            const out = tc.output as { leadId?: string } | undefined;
            if (out?.leadId) {
              const work = syncLeadToHubSpot(orgId, out.leadId);
              try { waitUntil(work); } catch { void work; }
            }
          }
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
  async function ingestInboundMessages(messages: InboundMessage[], replyAdapter: WhatsAppAdapter): Promise<void> {
    for (const msg of messages) {
      const acquired = await idempotencyService.tryAcquire(msg.providerMessageId);
      if (!acquired) {
        logger.info('Duplicate inbound event skipped', { providerMessageId: msg.providerMessageId });
        continue;
      }
      const stored = await messageService.persistInbound(defaultOrgId, msg);
      await handleInbound(defaultOrgId, {
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
        const html = buildQuotationHtml({
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
        ? await db.from('contacts').select('*').eq('organization_id', org).eq('id', found.id).maybeSingle()
        : { data: null };
      if (!contact) { res.status(404).json({ error: 'No data for that number' }); return; }
      const cid = contact.id;
      const [consent, leads, bookings, handoffs, convs] = await Promise.all([
        db.from('consent_records').select('*').eq('organization_id', org).eq('contact_id', cid),
        db.from('leads').select('*').eq('organization_id', org).eq('contact_id', cid),
        db.from('bookings').select('*').eq('organization_id', org).eq('contact_id', cid),
        db.from('handoffs').select('*').eq('organization_id', org).eq('contact_id', cid),
        db.from('conversations').select('id').eq('organization_id', org).eq('contact_id', cid),
      ]);
      const convIds = (convs.data ?? []).map((c) => c.id);
      const messages = convIds.length ? (await db.from('messages').select('direction, content, created_at').eq('organization_id', org).in('conversation_id', convIds)).data : [];
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
      await db.from('contacts').delete().eq('organization_id', org).eq('id', contact.id);
      await store.insertAuditEvent({ id: randomUUID(), organizationId: org, action: 'gdpr_erasure', entityType: 'contact', entityId: contact.id, actorType: 'user', details: { by: operator.userId }, createdAt: new Date().toISOString() });
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
    if (instagramAdapter) {
      app.get('/webhooks/instagram', (req, res) => {
        const challenge = instagramAdapter.verifyWebhook(
          String(req.query['hub.verify_token'] ?? ''), String(req.query['hub.challenge'] ?? ''),
        );
        if (challenge) res.status(200).send(challenge);
        else res.status(403).send('Forbidden');
      });

      app.post('/webhooks/instagram', async (req, res) => {
        // Meta signs IG/Messenger webhooks with the same app secret as WhatsApp.
        const raw = (req as express.Request & { rawBody?: Buffer }).rawBody;
        const sig = req.headers['x-hub-signature-256'];
        const appSecret = env['META_APP_SECRET'];
        if (appSecret) {
          const { createHmac } = await import('crypto');
          const expected = 'sha256=' + createHmac('sha256', appSecret).update(raw ?? Buffer.from('')).digest('hex');
          if (typeof sig !== 'string' || sig !== expected) { res.status(401).json({ error: 'Invalid signature' }); return; }
        }
        // Ack immediately, process in the background (Meta requires a fast 200).
        res.status(200).json({ received: true });
        const messages = instagramAdapter.parseInboundEvent(req.body);
        if (messages.length === 0) return;
        const work = ingestInboundMessages(messages, instagramAdapter);
        try { waitUntil(work); } catch { void work; }
      });
    }

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
      res.status(200).json({ ok: true, invite: data, acceptUrl });
    });

    app.get('/api/team/invites', async (req, res) => {
      const operator = await authoriseOperator(req);
      if (!operator) { res.status(401).json({ ok: false, error: 'Unauthorized' }); return; }
      const { data } = await db.from('team_invites')
        .select('id, email, role, status, created_at, accepted_at')
        .eq('organization_id', operator.organizationId).order('created_at', { ascending: false });
      res.status(200).json({ ok: true, invites: data ?? [] });
    });

    app.post('/api/team/invite/revoke', async (req, res) => {
      const operator = await authoriseOperator(req);
      if (!operator) { res.status(401).json({ ok: false, error: 'Unauthorized' }); return; }
      const id = (req.body as { id?: string })?.id;
      if (!id) { res.status(400).json({ ok: false, error: 'id required' }); return; }
      await db.from('team_invites').update({ status: 'revoked' }).eq('id', id).eq('organization_id', operator.organizationId);
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
