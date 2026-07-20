import express from 'express';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { createApp, type InboundCallbackMessage } from './app';
import { MockWhatsAppAdapter } from './adapters/mock-whatsapp-adapter';
import { MetaCloudApiAdapter } from './adapters/meta-cloud-api-adapter';
import { TwilioWhatsAppAdapter } from './adapters/twilio-whatsapp-adapter';
import type { WhatsAppAdapter, InboundMessage, InteractiveList, ReplyButton } from './adapters/types';
import type { AgentState } from '@business-os-ai/agent-core';
import { SupabaseIdempotencyService, SupabaseMessageService } from './services/supabase-services';
import { createServiceClient, type SupabaseClient } from '@business-os-ai/database';
import { SupabaseBusinessStore } from '@business-os-ai/mcp-business-tools';
import { createGatewayFromEnv, type LLMGateway } from '@business-os-ai/llm-gateway';
import {
  createEmbeddingProviderFromEnv, SupabaseVectorStore, executeAgentGraph,
  ingestMarkdownContent, runOwnerAssistant, isOwnerConfirmation,
  type AgentGraphDeps, type EmbeddingProvider,
} from '@business-os-ai/agent-core';
import { verifySupabaseAccessToken, getOrganizationRole } from '@business-os-ai/auth';
import { RazorpayPaymentService, buildQuotationHtml } from '@business-os-ai/commerce';
import {
  createEmailServiceFromEnv, createOcrServiceFromEnv, buildQuotationEmail,
} from '@business-os-ai/integrations';
import { SchedulerWorker } from '@business-os-ai/scheduler-worker';
import { logger } from '@business-os-ai/shared-types';
import { waitUntil } from '@vercel/functions';

/** Real-embedding similarity threshold for grounding decisions. */
const PROD_RETRIEVAL_THRESHOLD = 0.35;

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

  const publicBaseUrl = (env['PUBLIC_GATEWAY_URL'] ?? 'https://saarthione-api.vercel.app').replace(/\/$/, '');
  const emailService = createEmailServiceFromEnv(env);
  const ocrService = createOcrServiceFromEnv(env);

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
          for (const c of summary.staleContacts.slice(0, 10)) {
            if (!c.phone) continue;
            const re = `Hi ${c.name ?? 'there'}! 👋 Just checking in on your ${c.serviceInterest} enquiry — are you still interested? I’d be happy to help you take the next step.`;
            const r = await adapter.sendMessage(orgId, { to: c.phone, type: 'text', text: re, idempotencyKey: `reengage:${c.contactId}:${today}` });
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
      const state = await executeAgentGraph(store, {
        organizationId: orgId,
        contactId: msg.contactId,
        conversationId: msg.conversationId,
        inboundMessage: msg.text,
        traceId: msg.providerMessageId,
      }, agentDeps(orgId, org));

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
        }
      }

      await idempotencyService.markProcessed(msg.providerMessageId, orgId);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error('Agent runtime error', { providerMessageId: msg.providerMessageId, error: errorMsg });
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
    onInboundMessage: (orgId, msg) => handleInbound(orgId, msg, metaAdapter ?? adapter),
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
