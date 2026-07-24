import { supabase } from './supabase';
import type {
  ActivityTrendPoint,
  AdminMerchant,
  AdminMerchantsResult,
  AgentConfig,
  AgentTestResult,
  AutomationRunItem,
  BillingPlan,
  BusinessRules,
  CheckoutResult,
  IntegrationProvider,
  IntegrationsState,
  BroadcastRow,
  SegmentFilter,
  CampaignRow,
  CampaignStats,
  MarketingOverview,
  MerchantStatus,
  ContactNote,
  ContactRow,
  ConversationListItem,
  CreateTemplateInput,
  DashboardKpis,
  HandoffItem,
  HandoffReasonCount,
  KnowledgeDocRow,
  LeadFunnelStage,
  LeadItem,
  LlmModelUsage,
  LlmUsageSummary,
  MessageRow,
  MessageTemplateFull,
  MessageTemplateRow,
  Organization,
  PackageRow,
  ProductRow,
  TimelineEvent,
} from './types';

/* Stages considered "in-pipeline" for hot-lead scoring. */
const OPEN_LEAD_STAGES = ['new', 'contacted', 'qualified', 'proposal', 'negotiation'];

/* PostgREST returns embedded to-one relations as an object, but can return an
 * array depending on how the FK is detected. Normalize both shapes. */
function firstOrSelf<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }
  return (value as T | null | undefined) ?? null;
}

interface EmbeddedContact {
  name: string | null;
  phone_number: string | null;
}

function contactDisplay(value: unknown): { name: string; phone: string } {
  const contact = firstOrSelf<EmbeddedContact>(value as EmbeddedContact | EmbeddedContact[] | null);
  return {
    name: contact?.name ?? contact?.phone_number ?? 'Unknown contact',
    phone: contact?.phone_number ?? '',
  };
}

/* ─── Organization ────────────────────────────────────────────────── */

export async function fetchOrganization(): Promise<Organization | null> {
  try {
    const { data, error } = await supabase
      .from('organization_members')
      .select('organization_id, organizations(id, name)')
      .limit(1);

    if (!error && data && data.length > 0) {
      const first = data[0] as { organizations?: unknown } | undefined;
      const org = firstOrSelf<Organization>(
        (first?.organizations ?? null) as Organization | Organization[] | null
      );
      if (org) return org;
    }

    const { data: directOrgs } = await supabase
      .from('organizations')
      .select('id, name')
      .limit(1);

    if (directOrgs && directOrgs.length > 0) {
      return directOrgs[0] as Organization;
    }
  } catch (err) {
    console.warn('Organization fetch warning:', err);
  }

  return {
    id: '11111111-1111-1111-1111-111111111111',
    name: 'SaarthiOne',
  };
}

/**
 * Persist the chosen onboarding vertical to the organization.
 * Best-effort: RLS may block the update, so any error is swallowed into a
 * returned message string (null on success). Never throws.
 */
export async function updateOrganizationVertical(
  organizationId: string,
  vertical: string
): Promise<string | null> {
  try {
    const { error } = await supabase
      .from('organizations')
      .update({ vertical })
      .eq('id', organizationId);
    if (error) return error.message;
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : 'Failed to update organization vertical';
  }
}

/* ─── Inbox: conversations, messages, handoffs ────────────────────── */

export async function fetchConversations(): Promise<ConversationListItem[]> {
  const { data, error } = await supabase
    .from('conversations')
    .select(
      'id, contact_id, channel, status, created_at, contacts(name, phone_number), messages(content, created_at)'
    )
    .order('created_at', { ascending: false })
    .order('created_at', { referencedTable: 'messages', ascending: false })
    .limit(1, { referencedTable: 'messages' })
    .limit(100);
  if (error) throw new Error(`Failed to load conversations: ${error.message}`);
  return (data ?? []).map((row: any): ConversationListItem => {
    const contact = contactDisplay(row.contacts);
    const lastMessage = firstOrSelf<{ content: string; created_at: string }>(row.messages);
    return {
      id: row.id,
      contact_id: row.contact_id ?? null,
      channel: row.channel ?? 'whatsapp',
      status: row.status ?? 'active',
      created_at: row.created_at,
      contactName: contact.name,
      contactPhone: contact.phone,
      lastMessage: lastMessage?.content ?? null,
      lastMessageAt: lastMessage?.created_at ?? null,
    };
  });
}

export async function fetchMessages(conversationId: string): Promise<MessageRow[]> {
  const { data, error } = await supabase
    .from('messages')
    .select('id, conversation_id, direction, message_type, content, created_at')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true });
  if (error) throw new Error(`Failed to load messages: ${error.message}`);
  return (data ?? []) as MessageRow[];
}

export async function fetchHandoffs(): Promise<HandoffItem[]> {
  const { data, error } = await supabase
    .from('handoffs')
    .select(
      'id, conversation_id, contact_id, reason, priority, status, summary, claimed_by, created_at, contacts(name, phone_number)'
    )
    .in('status', ['pending', 'claimed'])
    .order('created_at', { ascending: false });
  if (error) throw new Error(`Failed to load handoffs: ${error.message}`);
  return (data ?? []).map((row: any): HandoffItem => {
    const contact = contactDisplay(row.contacts);
    return {
      id: row.id,
      conversation_id: row.conversation_id,
      contact_id: row.contact_id ?? null,
      reason: row.reason ?? 'unspecified',
      priority: row.priority ?? 'medium',
      status: row.status,
      summary: row.summary ?? null,
      claimed_by: row.claimed_by ?? null,
      created_at: row.created_at,
      contactName: contact.name,
      contactPhone: contact.phone,
    };
  });
}

export async function claimHandoff(handoffId: string, userId: string): Promise<void> {
  const { error } = await supabase
    .from('handoffs')
    .update({ status: 'claimed', claimed_by: userId })
    .eq('id', handoffId);
  if (error) throw new Error(`Failed to claim handoff: ${error.message}`);
}

export async function resolveHandoff(handoffId: string): Promise<void> {
  const { error } = await supabase
    .from('handoffs')
    .update({ status: 'resolved' })
    .eq('id', handoffId);
  if (error) throw new Error(`Failed to resolve handoff: ${error.message}`);
}

export async function resolveConversation(conversationId: string): Promise<void> {
  const { error } = await supabase
    .from('conversations')
    .update({ status: 'resolved' })
    .eq('id', conversationId);
  if (error) throw new Error(`Failed to resolve conversation: ${error.message}`);
}

/* ─── Operator reply via gateway ──────────────────────────────────── */

export async function sendOperatorMessage(
  accessToken: string,
  conversationId: string,
  text: string
): Promise<void> {
  const response = await fetch(`${import.meta.env.VITE_GATEWAY_URL}/api/operator/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ conversationId, text }),
  });
  if (!response.ok) {
    let detail = '';
    try {
      detail = (await response.text()).slice(0, 200);
    } catch {
      /* body unreadable — status alone is enough */
    }
    throw new Error(`Send failed (HTTP ${response.status})${detail ? `: ${detail}` : ''}`);
  }
}

/* ─── Team invites ────────────────────────────────────────────────── */

export interface TeamInvite {
  id: string;
  email: string;
  role: string;
  status: 'pending' | 'accepted' | 'revoked';
  created_at: string;
  accepted_at?: string | null;
}

/** Invite a teammate by email (gateway sends the email + creates the invite). */
export async function inviteTeamMember(
  accessToken: string, email: string, role: 'operator' | 'admin' = 'operator'
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`${import.meta.env.VITE_GATEWAY_URL}/api/team/invite`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, role }),
    });
    const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (!res.ok || !body.ok) return { ok: false, error: body.error ?? `HTTP ${res.status}` };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}

export async function fetchTeamInvites(accessToken: string): Promise<TeamInvite[]> {
  try {
    const res = await fetch(`${import.meta.env.VITE_GATEWAY_URL}/api/team/invites`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const body = (await res.json().catch(() => ({}))) as { invites?: TeamInvite[] };
    return body.invites ?? [];
  } catch {
    return [];
  }
}

export async function revokeTeamInvite(accessToken: string, id: string): Promise<void> {
  await fetch(`${import.meta.env.VITE_GATEWAY_URL}/api/team/invite/revoke`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  }).catch(() => { /* best-effort */ });
}

/** Accept an invite token (the signed-in user joins the inviting org). */
export async function acceptTeamInvite(
  accessToken: string, token: string
): Promise<{ ok: boolean; organizationId?: string; error?: string }> {
  try {
    const res = await fetch(`${import.meta.env.VITE_GATEWAY_URL}/api/invite/accept`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    const body = (await res.json().catch(() => ({}))) as { ok?: boolean; organizationId?: string; error?: string };
    if (!res.ok || !body.ok) return { ok: false, error: body.error ?? `HTTP ${res.status}` };
    return { ok: true, organizationId: body.organizationId };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}

/* ─── Onboarding: WhatsApp Embedded Signup ────────────────────────── */

export interface CompleteWhatsappSignupPayload {
  code: string;
  phoneNumberId?: string;
  wabaId?: string;
}

export interface CompleteWhatsappSignupResult {
  ok: boolean;
  displayPhoneNumber?: string;
  error?: string;
}

/**
 * Exchange the Meta Embedded Signup `code` (plus the phone_number_id / waba_id
 * captured from the postMessage) for a fully-provisioned WhatsApp connection on
 * the gateway. Never throws — always resolves with an {ok} result.
 */
export async function completeWhatsappSignup(
  accessToken: string,
  payload: CompleteWhatsappSignupPayload
): Promise<CompleteWhatsappSignupResult> {
  try {
    const response = await fetch(
      `${import.meta.env.VITE_GATEWAY_URL}/api/onboarding/whatsapp`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          code: payload.code,
          phoneNumberId: payload.phoneNumberId,
          wabaId: payload.wabaId,
        }),
      }
    );

    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      /* Body may be empty or non-JSON; fall back to status. */
    }
    const parsed = (body ?? {}) as { displayPhoneNumber?: string; error?: string; message?: string };

    if (response.ok) {
      return { ok: true, displayPhoneNumber: parsed.displayPhoneNumber };
    }
    return {
      ok: false,
      error: parsed.error ?? parsed.message ?? `HTTP ${response.status}`,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}

/* ─── Onboarding: merchant profile, payments, terms, completion ───── */

export interface MerchantProfile {
  legalName: string;
  businessType: string;
  contactName: string;
  contactPhone: string;
  city: string;
  gstNumber?: string;
  pan?: string;
}

/**
 * Persist the merchant's business profile (step 1 of onboarding). Never throws —
 * always resolves with an {ok} result so the caller can render an inline error
 * and block advancing.
 */
export async function saveMerchantProfile(
  token: string,
  profile: MerchantProfile
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`${import.meta.env.VITE_GATEWAY_URL}/api/onboarding/profile`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(profile),
    });
    const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (!res.ok || body.ok === false) return { ok: false, error: body.error ?? `HTTP ${res.status}` };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}

/**
 * Connect the merchant's own Razorpay account (step 4). Returns the detected
 * `mode` ('test'/'live') on success. Never throws.
 */
export async function connectPayment(
  token: string,
  creds: { keyId: string; keySecret: string; webhookSecret?: string }
): Promise<{ ok: boolean; mode?: 'test' | 'live'; error?: string }> {
  try {
    const res = await fetch(`${import.meta.env.VITE_GATEWAY_URL}/api/onboarding/payment`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(creds),
    });
    const body = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      mode?: 'test' | 'live';
      error?: string;
    };
    if (!res.ok || body.ok === false) return { ok: false, error: body.error ?? `HTTP ${res.status}` };
    return { ok: true, mode: body.mode };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}

/* ─── Bookings awaiting payment (manual/UPI confirmation) ─────────── */

export interface PendingBooking {
  id: string;
  bookingNumber: string;
  amount: number;
  status: string;
  customerName: string | null;
  createdAt: string;
  summary: string;
}

export async function fetchPendingBookings(token: string): Promise<PendingBooking[]> {
  try {
    const res = await fetch(`${import.meta.env.VITE_GATEWAY_URL}/api/bookings/pending`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = (await res.json().catch(() => ({}))) as { bookings?: PendingBooking[] };
    return body.bookings ?? [];
  } catch {
    return [];
  }
}

/** Operator marks a booking as paid → confirms it + notifies the customer. */
export async function confirmBookingPaid(token: string, bookingId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`${import.meta.env.VITE_GATEWAY_URL}/api/bookings/${bookingId}/confirm`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (!res.ok || body.ok === false) return { ok: false, error: body.error ?? `HTTP ${res.status}` };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}

/**
 * Connect the merchant's own UPI ID (gateway-free). Customers pay directly into
 * this VPA; confirmation is manual (no auto webhook). Never throws.
 */
export async function connectUpi(
  token: string,
  creds: { upiVpa: string; payeeName?: string }
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`${import.meta.env.VITE_GATEWAY_URL}/api/onboarding/upi`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(creds),
    });
    const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (!res.ok || body.ok === false) return { ok: false, error: body.error ?? `HTTP ${res.status}` };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}

/** Record the merchant's acceptance of the terms of service (step 7). Never throws. */
export async function acceptTerms(
  token: string,
  body: { termsVersion: string }
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`${import.meta.env.VITE_GATEWAY_URL}/api/onboarding/terms`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const parsed = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (!res.ok || parsed.ok === false) return { ok: false, error: parsed.error ?? `HTTP ${res.status}` };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}

/**
 * Finalize onboarding (step 7). Returns the resulting account `status`
 * ('active' → go straight to dashboard; 'pending_review' → await activation).
 * Never throws.
 */
export async function completeOnboarding(
  token: string
): Promise<{ ok: boolean; status?: string; error?: string }> {
  try {
    const res = await fetch(`${import.meta.env.VITE_GATEWAY_URL}/api/onboarding/complete`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    });
    const body = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      status?: string;
      error?: string;
    };
    if (!res.ok || body.ok === false) return { ok: false, error: body.error ?? `HTTP ${res.status}` };
    return { ok: true, status: body.status };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}

/** Best-effort read of the current onboarding progress. Returns {} on any error. */
export async function fetchOnboardingState(token: string): Promise<{
  profileComplete?: boolean;
  paymentConnected?: boolean;
  termsAccepted?: boolean;
  status?: string;
}> {
  try {
    const res = await fetch(`${import.meta.env.VITE_GATEWAY_URL}/api/onboarding/state`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return {};
    return (await res.json().catch(() => ({}))) as {
      profileComplete?: boolean;
      paymentConnected?: boolean;
      termsAccepted?: boolean;
      status?: string;
    };
  } catch {
    return {};
  }
}

/* ─── CRM: leads, contacts, catalog, knowledge ────────────────────── */

export async function fetchLeads(): Promise<LeadItem[]> {
  const { data, error } = await supabase
    .from('leads')
    .select(
      'id, contact_id, stage, service_interest, score, qualification_summary, created_at, contacts(name, phone_number)'
    )
    .order('created_at', { ascending: false });
  if (error) throw new Error(`Failed to load leads: ${error.message}`);
  return (data ?? []).map((row: any): LeadItem => {
    const contact = contactDisplay(row.contacts);
    return {
      id: row.id,
      contact_id: row.contact_id ?? null,
      stage: row.stage ?? 'new',
      service_interest: row.service_interest ?? null,
      score: row.score === null || row.score === undefined ? null : Number(row.score),
      qualification_summary: row.qualification_summary ?? null,
      created_at: row.created_at,
      contactName: contact.name,
      contactPhone: contact.phone,
    };
  });
}

export async function fetchContacts(): Promise<ContactRow[]> {
  const { data, error } = await supabase
    .from('contacts')
    .select('id, name, phone_number, email, tags, preferred_language, last_seen_at')
    .order('name', { ascending: true });
  if (error) throw new Error(`Failed to load contacts: ${error.message}`);
  return (data ?? []) as ContactRow[];
}

/* ─── Business Brain: per-customer memory + operator notes ─────────── */

export async function fetchContactNotes(contactId: string): Promise<ContactNote[]> {
  const { data, error } = await supabase
    .from('contact_notes')
    .select('id,kind,body,created_at')
    .eq('contact_id', contactId)
    .order('created_at', { ascending: false });
  if (error) throw new Error(`Failed to load notes: ${error.message}`);
  return (data ?? []) as ContactNote[];
}

export async function addContactNote(contactId: string, body: string): Promise<void> {
  const text = body.trim();
  if (!text) throw new Error('Note cannot be empty');

  // contact_notes.organization_id is NOT NULL — resolve it from the contact row.
  const { data: contact, error: contactError } = await supabase
    .from('contacts')
    .select('organization_id')
    .eq('id', contactId)
    .single();
  if (contactError) throw new Error(`Failed to add note: ${contactError.message}`);
  const organizationId = (contact as { organization_id?: string } | null)?.organization_id;
  if (!organizationId) throw new Error('Failed to add note: contact has no organization');

  const { error } = await supabase.from('contact_notes').insert({
    contact_id: contactId,
    organization_id: organizationId,
    kind: 'note',
    body: text,
  });
  if (error) throw new Error(`Failed to add note: ${error.message}`);
}

export async function deleteContactNote(id: string): Promise<void> {
  const { error } = await supabase.from('contact_notes').delete().eq('id', id);
  if (error) throw new Error(`Failed to delete note: ${error.message}`);
}

export async function fetchProducts(): Promise<ProductRow[]> {
  const { data, error } = await supabase
    .from('products')
    .select('id, sku, name, description, category, base_price, currency, status')
    .order('name', { ascending: true });
  if (error) throw new Error(`Failed to load products: ${error.message}`);
  return (data ?? []) as ProductRow[];
}

export async function fetchPackages(): Promise<PackageRow[]> {
  const { data, error } = await supabase
    .from('packages')
    .select('id, sku, title, duration_days, price_per_person, currency, inclusions, status')
    .order('title', { ascending: true });
  if (error) throw new Error(`Failed to load packages: ${error.message}`);
  return (data ?? []) as PackageRow[];
}

export async function fetchKnowledgeDocs(): Promise<KnowledgeDocRow[]> {
  const { data, error } = await supabase
    .from('knowledge_documents')
    .select('id, title, source_path, status')
    .order('title', { ascending: true });
  if (error) throw new Error(`Failed to load knowledge documents: ${error.message}`);
  return (data ?? []) as KnowledgeDocRow[];
}

export async function fetchMessageTemplates(): Promise<MessageTemplateRow[]> {
  const { data, error } = await supabase
    .from('message_templates')
    .select('id, template_key, name, content, status')
    .order('name', { ascending: true });
  if (error) throw new Error(`Failed to load message templates: ${error.message}`);
  return (data ?? []) as MessageTemplateRow[];
}

/* ─── Template management (list full rows + create) ───────────────── */

export async function fetchTemplatesFull(): Promise<MessageTemplateFull[]> {
  const { data, error } = await supabase
    .from('message_templates')
    .select('id, template_key, name, content, language, status, category, created_at')
    .order('created_at', { ascending: false });
  if (error) throw new Error(`Failed to load templates: ${error.message}`);
  return (data ?? []) as MessageTemplateFull[];
}

/* Build a WhatsApp-safe template_key: slug of the name + a short random suffix. */
function slugifyTemplateKey(name: string): string {
  const slug = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${slug || 'template'}_${suffix}`;
}

export async function createTemplate(input: CreateTemplateInput): Promise<void> {
  const name = input.name.trim();
  const content = input.content.trim();
  if (!name) throw new Error('Template name is required');
  if (!content) throw new Error('Template content is required');

  const { error } = await supabase.from('message_templates').insert({
    organization_id: input.organizationId,
    template_key: slugifyTemplateKey(name),
    name,
    category: input.category,
    language: (input.language || 'en').trim(),
    content,
    status: 'pending',
  });
  if (error) throw new Error(`Failed to create template: ${error.message}`);
}

/* ─── Scheduler: automation runs ──────────────────────────────────── */

export async function fetchAutomationRuns(): Promise<AutomationRunItem[]> {
  const { data, error } = await supabase
    .from('automation_runs')
    .select(
      'id, contact_id, campaign_type, template_key, status, scheduled_for, contacts(name, phone_number)'
    )
    .order('scheduled_for', { ascending: false })
    .limit(100);
  if (error) throw new Error(`Failed to load automation runs: ${error.message}`);
  return (data ?? []).map((row: any): AutomationRunItem => {
    const contact = contactDisplay(row.contacts);
    return {
      id: row.id,
      contact_id: row.contact_id ?? null,
      campaign_type: row.campaign_type ?? 'unknown',
      template_key: row.template_key ?? null,
      status: row.status ?? 'unknown',
      scheduled_for: row.scheduled_for ?? null,
      contactName: contact.name,
      contactPhone: contact.phone,
    };
  });
}

export interface QueueCampaignInput {
  organizationId: string;
  contactId: string;
  templateKey: string;
  scheduledForIso: string;
}

export async function queueAutomationRun(input: QueueCampaignInput): Promise<void> {
  const { error } = await supabase.from('automation_runs').insert({
    organization_id: input.organizationId,
    contact_id: input.contactId,
    campaign_type: 'qualified_lead_followup',
    template_key: input.templateKey,
    idempotency_key: `ui:${crypto.randomUUID()}`,
    status: 'scheduled',
    scheduled_for: input.scheduledForIso,
  });
  if (error) throw new Error(`Failed to queue campaign: ${error.message}`);
}

/* ─── Compliance / AI observability ───────────────────────────────── */

export async function fetchLlmUsageSummary(): Promise<LlmUsageSummary> {
  const { data, error } = await supabase
    .from('llm_usage')
    .select('provider, model, total_tokens, estimated_cost_usd');
  if (error) throw new Error(`Failed to load LLM usage: ${error.message}`);
  const rows = (data ?? []) as Array<{
    provider: string | null;
    model: string | null;
    total_tokens: number | string | null;
    estimated_cost_usd: number | string | null;
  }>;

  const byModelMap = new Map<string, LlmModelUsage>();
  let totalTokens = 0;
  let totalCostUsd = 0;
  for (const row of rows) {
    const provider = row.provider ?? 'unknown';
    const model = row.model ?? 'unknown';
    const tokens = Number(row.total_tokens ?? 0) || 0;
    const cost = Number(row.estimated_cost_usd ?? 0) || 0;
    totalTokens += tokens;
    totalCostUsd += cost;
    const key = `${provider}/${model}`;
    const existing = byModelMap.get(key);
    if (existing) {
      existing.requests += 1;
      existing.tokens += tokens;
      existing.costUsd += cost;
    } else {
      byModelMap.set(key, { provider, model, requests: 1, tokens, costUsd: cost });
    }
  }

  return {
    totalRequests: rows.length,
    totalTokens,
    totalCostUsd,
    byModel: Array.from(byModelMap.values()).sort((a, b) => b.costUsd - a.costUsd),
  };
}

export async function fetchHandoffReasonCounts(): Promise<HandoffReasonCount[]> {
  const { data, error } = await supabase.from('handoffs').select('reason');
  if (error) throw new Error(`Failed to load handoff stats: ${error.message}`);
  const counts = new Map<string, number>();
  for (const row of (data ?? []) as Array<{ reason: string | null }>) {
    const reason = row.reason ?? 'unspecified';
    counts.set(reason, (counts.get(reason) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count);
}

/* ─── Dashboard KPI strip ─────────────────────────────────────────── */

export async function fetchDashboardKpis(): Promise<DashboardKpis> {
  const startOfTodayUtc = new Date(
    Date.UTC(
      new Date().getUTCFullYear(),
      new Date().getUTCMonth(),
      new Date().getUTCDate()
    )
  ).toISOString();

  const [convRes, leadsRes, bookingsRes, ordersRes] = await Promise.all([
    supabase
      .from('conversations')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', startOfTodayUtc),
    supabase.from('leads').select('stage, score'),
    supabase.from('bookings').select('status, total_amount'),
    supabase.from('orders').select('status, total_amount'),
  ]);

  if (convRes.error) throw new Error(`Failed to load KPIs (conversations): ${convRes.error.message}`);
  if (leadsRes.error) throw new Error(`Failed to load KPIs (leads): ${leadsRes.error.message}`);
  if (bookingsRes.error) throw new Error(`Failed to load KPIs (bookings): ${bookingsRes.error.message}`);
  if (ordersRes.error) throw new Error(`Failed to load KPIs (orders): ${ordersRes.error.message}`);

  const leadRows = (leadsRes.data ?? []) as Array<{ stage: string | null; score: number | string | null }>;
  let qualifiedLeads = 0;
  let hotLeads = 0;
  for (const lead of leadRows) {
    const stage = lead.stage ?? 'new';
    const score = Number(lead.score ?? 0) || 0;
    if (stage === 'qualified') qualifiedLeads += 1;
    if (score >= 70 && OPEN_LEAD_STAGES.includes(stage)) hotLeads += 1;
  }

  const bookingRows = (bookingsRes.data ?? []) as Array<{
    status: string | null;
    total_amount: number | string | null;
  }>;
  let bookingsTotal = 0;
  let bookingsConfirmed = 0;
  let pendingPayments = 0;
  let revenuePipeline = 0;
  for (const booking of bookingRows) {
    bookingsTotal += 1;
    const status = booking.status ?? '';
    const amount = Number(booking.total_amount ?? 0) || 0;
    if (status === 'confirmed' || status === 'paid') bookingsConfirmed += 1;
    if (status === 'pending' || status === 'confirmed') {
      pendingPayments += 1;
      revenuePipeline += amount;
    }
  }

  const orderRows = (ordersRes.data ?? []) as Array<{
    status: string | null;
    total_amount: number | string | null;
  }>;
  for (const order of orderRows) {
    if ((order.status ?? '') === 'pending_payment') {
      pendingPayments += 1;
      revenuePipeline += Number(order.total_amount ?? 0) || 0;
    }
  }

  return {
    conversationsToday: convRes.count ?? 0,
    qualifiedLeads,
    hotLeads,
    bookingsTotal,
    bookingsConfirmed,
    pendingPayments,
    revenuePipeline,
  };
}

/* ─── Analytics: 14-day activity trend + lead funnel ──────────────── */

const TREND_DAYS = 14;

/* UTC calendar date (YYYY-MM-DD) for an ISO timestamp. */
function utcDateKey(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

export async function fetchActivityTrend(): Promise<ActivityTrendPoint[]> {
  const now = new Date();
  // Start of the earliest day in the window (UTC midnight, TREND_DAYS-1 days ago).
  const startUtc = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() - (TREND_DAYS - 1)
    )
  );
  const startIso = startUtc.toISOString();

  const [messagesRes, leadsRes, bookingsRes] = await Promise.all([
    supabase.from('messages').select('created_at').gte('created_at', startIso),
    supabase.from('leads').select('created_at').gte('created_at', startIso),
    supabase.from('bookings').select('created_at').gte('created_at', startIso),
  ]);

  if (messagesRes.error) throw new Error(`Failed to load activity trend (messages): ${messagesRes.error.message}`);
  if (leadsRes.error) throw new Error(`Failed to load activity trend (leads): ${leadsRes.error.message}`);
  if (bookingsRes.error) throw new Error(`Failed to load activity trend (bookings): ${bookingsRes.error.message}`);

  // Seed an ordered map with every day in the window so gaps render as zero.
  const buckets = new Map<string, ActivityTrendPoint>();
  for (let i = 0; i < TREND_DAYS; i += 1) {
    const d = new Date(startUtc.getTime() + i * 86_400_000);
    const key = d.toISOString().slice(0, 10);
    buckets.set(key, { date: key, messages: 0, leads: 0, bookings: 0 });
  }

  const tally = (
    rows: Array<{ created_at: string | null }> | null,
    field: 'messages' | 'leads' | 'bookings'
  ): void => {
    for (const row of rows ?? []) {
      if (!row.created_at) continue;
      const bucket = buckets.get(utcDateKey(row.created_at));
      if (bucket) bucket[field] += 1;
    }
  };

  tally(messagesRes.data as Array<{ created_at: string | null }> | null, 'messages');
  tally(leadsRes.data as Array<{ created_at: string | null }> | null, 'leads');
  tally(bookingsRes.data as Array<{ created_at: string | null }> | null, 'bookings');

  return Array.from(buckets.values());
}

const FUNNEL_STAGES = ['new', 'contacted', 'qualified', 'proposal', 'won'];

export async function fetchLeadFunnel(): Promise<LeadFunnelStage[]> {
  const { data, error } = await supabase.from('leads').select('stage');
  if (error) throw new Error(`Failed to load lead funnel: ${error.message}`);

  const counts = new Map<string, number>();
  for (const stage of FUNNEL_STAGES) counts.set(stage, 0);
  for (const row of (data ?? []) as Array<{ stage: string | null }>) {
    const stage = row.stage ?? 'new';
    if (counts.has(stage)) counts.set(stage, (counts.get(stage) ?? 0) + 1);
  }
  return FUNNEL_STAGES.map((stage) => ({ stage, count: counts.get(stage) ?? 0 }));
}

/* ─── Billing / upgrade (Stripe checkout via gateway) ─────────────── */

/**
 * Start a Stripe checkout for the selected plan. Never throws — always resolves
 * with an {ok} result so the caller can render an inline message (e.g. when
 * billing/Stripe isn't configured on the gateway yet).
 */
export async function startCheckout(
  accessToken: string,
  plan: BillingPlan
): Promise<CheckoutResult> {
  try {
    const response = await fetch(`${import.meta.env.VITE_GATEWAY_URL}/api/billing/checkout`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ plan }),
    });

    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      /* Body may be empty or non-JSON; fall back to status. */
    }
    const parsed = (body ?? {}) as { ok?: boolean; url?: string; error?: string; message?: string };

    if (response.ok && parsed.ok && parsed.url) {
      return { ok: true, url: parsed.url };
    }
    return {
      ok: false,
      error: parsed.error ?? parsed.message ?? `Checkout unavailable (HTTP ${response.status})`,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}

/* ─── AI Team & Business Rules (agent config via gateway) ─────────── */

/**
 * Read the operator's current agent config (business rules + enabled agents).
 * Operator-authed. Never throws — always resolves with an {ok} result.
 */
export async function fetchAgentConfig(token: string): Promise<AgentConfig> {
  try {
    const res = await fetch(`${import.meta.env.VITE_GATEWAY_URL}/api/config`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      rules?: BusinessRules;
      enabledAgents?: string[];
      error?: string;
    };
    if (!res.ok || body.ok === false) return { ok: false, error: body.error ?? `HTTP ${res.status}` };
    return { ok: true, rules: body.rules ?? {}, enabledAgents: body.enabledAgents ?? [] };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}

/** Persist the business rules. Body is the rules object itself. Never throws. */
export async function saveBusinessRules(
  token: string,
  rules: BusinessRules
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`${import.meta.env.VITE_GATEWAY_URL}/api/config/rules`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(rules),
    });
    const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (!res.ok || body.ok === false) return { ok: false, error: body.error ?? `HTTP ${res.status}` };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}

/** Persist the set of enabled agents (lowercased role ids). Never throws. */
export async function saveEnabledAgents(
  token: string,
  enabledAgents: string[]
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`${import.meta.env.VITE_GATEWAY_URL}/api/config/team`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabledAgents }),
    });
    const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (!res.ok || body.ok === false) return { ok: false, error: body.error ?? `HTTP ${res.status}` };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}

/**
 * Send a message to the configured AI and get its reply (+ detected intent).
 * Used by the onboarding "Test your AI" step and the dashboard AI Settings tab.
 * Never throws.
 */
export async function testAgent(token: string, message: string): Promise<AgentTestResult> {
  try {
    const res = await fetch(`${import.meta.env.VITE_GATEWAY_URL}/api/agent/test`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
    });
    const body = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      reply?: string;
      intent?: string;
      error?: string;
    };
    if (!res.ok || body.ok === false) return { ok: false, error: body.error ?? `HTTP ${res.status}` };
    return { ok: true, reply: body.reply, intent: body.intent };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}

/* ─── Customer Memory timeline (per-contact history) ──────────────── */

export async function fetchContactTimeline(
  contactId: string,
  organizationId: string
): Promise<TimelineEvent[]> {
  const inr = (amount: number | string | null): string =>
    `₹${(Number(amount ?? 0) || 0).toLocaleString('en-IN')}`;

  const [leadsRes, bookingsRes, handoffsRes] = await Promise.all([
    supabase
      .from('leads')
      .select('service_interest, score, created_at')
      .eq('contact_id', contactId)
      .eq('organization_id', organizationId),
    supabase
      .from('bookings')
      .select('booking_number, total_amount, status, created_at')
      .eq('contact_id', contactId)
      .eq('organization_id', organizationId),
    supabase
      .from('handoffs')
      .select('reason, created_at')
      .eq('contact_id', contactId)
      .eq('organization_id', organizationId),
  ]);

  if (leadsRes.error) throw new Error(`Failed to load timeline (leads): ${leadsRes.error.message}`);
  if (bookingsRes.error) throw new Error(`Failed to load timeline (bookings): ${bookingsRes.error.message}`);
  if (handoffsRes.error) throw new Error(`Failed to load timeline (handoffs): ${handoffsRes.error.message}`);

  const events: TimelineEvent[] = [];

  for (const lead of (leadsRes.data ?? []) as Array<{
    service_interest: string | null;
    score: number | string | null;
    created_at: string;
  }>) {
    const score = lead.score === null || lead.score === undefined ? null : Number(lead.score);
    events.push({
      at: lead.created_at,
      icon: '🎯',
      title: `Qualified interest: ${lead.service_interest ?? 'general enquiry'}`,
      detail: score === null ? undefined : `Lead score ${score}/100`,
    });
  }

  for (const booking of (bookingsRes.data ?? []) as Array<{
    booking_number: string | null;
    total_amount: number | string | null;
    status: string | null;
    created_at: string;
  }>) {
    events.push({
      at: booking.created_at,
      icon: '📅',
      title: `Booking ${booking.booking_number ?? '—'} — ${inr(booking.total_amount)} — ${booking.status ?? 'unknown'}`,
    });
  }

  for (const handoff of (handoffsRes.data ?? []) as Array<{
    reason: string | null;
    created_at: string;
  }>) {
    events.push({
      at: handoff.created_at,
      icon: '🙋',
      title: `Escalated to human: ${(handoff.reason ?? 'unspecified').replace(/_/g, ' ')}`,
    });
  }

  // Oldest-first chronological order.
  events.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  return events;
}

/* ─── Platform admin: merchant management (operator-authed) ───────── */

/**
 * List all merchants for a platform admin. The gateway returns
 * `{ isAdmin:false, merchants:[] }` for non-admins — the caller uses `isAdmin`
 * to decide whether to show the Admin tab. Never throws.
 */
export async function fetchAdminMerchants(token: string): Promise<AdminMerchantsResult> {
  try {
    const res = await fetch(`${import.meta.env.VITE_GATEWAY_URL}/api/admin/merchants`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      isAdmin?: boolean;
      merchants?: AdminMerchant[];
      error?: string;
    };
    if (!res.ok || body.ok === false) {
      return { ok: false, isAdmin: false, merchants: [], error: body.error ?? `HTTP ${res.status}` };
    }
    return { ok: true, isAdmin: Boolean(body.isAdmin), merchants: body.merchants ?? [] };
  } catch (err) {
    return {
      ok: false,
      isAdmin: false,
      merchants: [],
      error: err instanceof Error ? err.message : 'Network error',
    };
  }
}

/** Set a merchant's account status (admin only). Never throws. */
export async function setMerchantStatus(
  token: string,
  id: string,
  status: MerchantStatus
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(
      `${import.meta.env.VITE_GATEWAY_URL}/api/admin/merchants/${id}/status`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      }
    );
    const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (!res.ok || body.ok === false) return { ok: false, error: body.error ?? `HTTP ${res.status}` };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}

/* ─── Per-tenant integrations (HubSpot, Instagram/Messenger) ──────── */

/** Read the merchant's current integration connection state. Never throws. */
const EMPTY_SHEETS: IntegrationsState['googleSheets'] = {
  connected: false,
  available: false,
  leadsTab: 'Leads',
  contactsTab: 'Contacts',
  reportsTab: 'Reports',
  syncLeads: true,
};

export async function fetchIntegrations(token: string): Promise<IntegrationsState> {
  try {
    const res = await fetch(`${import.meta.env.VITE_GATEWAY_URL}/api/integrations`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      hubspot?: { connected?: boolean };
      instagram?: { connected?: boolean; pageId?: string };
      googleSheets?: Partial<IntegrationsState['googleSheets']>;
      error?: string;
    };
    if (!res.ok || body.ok === false) {
      return {
        ok: false,
        hubspot: { connected: false },
        instagram: { connected: false },
        googleSheets: EMPTY_SHEETS,
        error: body.error ?? `HTTP ${res.status}`,
      };
    }
    const gs = body.googleSheets ?? {};
    return {
      ok: true,
      hubspot: { connected: Boolean(body.hubspot?.connected) },
      instagram: {
        connected: Boolean(body.instagram?.connected),
        pageId: body.instagram?.pageId,
      },
      googleSheets: {
        connected: Boolean(gs.connected),
        available: Boolean(gs.available),
        serviceAccountEmail: gs.serviceAccountEmail,
        spreadsheetId: gs.spreadsheetId,
        spreadsheetUrl: gs.spreadsheetUrl,
        title: gs.title,
        leadsTab: gs.leadsTab ?? 'Leads',
        contactsTab: gs.contactsTab ?? 'Contacts',
        reportsTab: gs.reportsTab ?? 'Reports',
        syncLeads: gs.syncLeads !== false,
      },
    };
  } catch (err) {
    return {
      ok: false,
      hubspot: { connected: false },
      instagram: { connected: false },
      googleSheets: EMPTY_SHEETS,
      error: err instanceof Error ? err.message : 'Network error',
    };
  }
}

/** Connect the merchant's own HubSpot private app. Never throws. */
export async function connectHubspot(
  token: string,
  creds: { accessToken: string; webhookSecret?: string }
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`${import.meta.env.VITE_GATEWAY_URL}/api/integrations/hubspot`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(creds),
    });
    const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (!res.ok || body.ok === false) return { ok: false, error: body.error ?? `HTTP ${res.status}` };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}

/** Connect the merchant's own Instagram / Facebook page. Never throws. */
export async function connectInstagram(
  token: string,
  creds: { pageId: string; pageAccessToken: string; verifyToken?: string }
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`${import.meta.env.VITE_GATEWAY_URL}/api/integrations/instagram`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(creds),
    });
    const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (!res.ok || body.ok === false) return { ok: false, error: body.error ?? `HTTP ${res.status}` };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}

/** Disconnect an integration (`hubspot` | `instagram`). Never throws. */
export async function disconnectIntegration(
  token: string,
  provider: IntegrationProvider
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`${import.meta.env.VITE_GATEWAY_URL}/api/integrations/${provider}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (!res.ok || body.ok === false) return { ok: false, error: body.error ?? `HTTP ${res.status}` };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}

/** Connect a Google Sheet (paste its URL after sharing with the SA). Never throws. */
export async function connectGoogleSheets(
  token: string,
  input: { spreadsheetUrl: string; leadsTab?: string; contactsTab?: string; reportsTab?: string; syncLeads?: boolean }
): Promise<{ ok: boolean; title?: string; error?: string }> {
  try {
    const res = await fetch(`${import.meta.env.VITE_GATEWAY_URL}/api/integrations/google_sheets`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    const body = (await res.json().catch(() => ({}))) as { ok?: boolean; title?: string; error?: string };
    if (!res.ok || body.ok === false) return { ok: false, error: body.error ?? `HTTP ${res.status}` };
    return { ok: true, title: body.title };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}

/** Broadcast an approved template to the connected sheet's contacts. Never throws. */
export async function broadcastFromSheet(
  token: string,
  input: { templateKey?: string; tab?: string; limit?: number }
): Promise<{ ok: boolean; total?: number; truncated?: boolean; requested?: number; error?: string }> {
  try {
    const res = await fetch(`${import.meta.env.VITE_GATEWAY_URL}/api/broadcast`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    const body = (await res.json().catch(() => ({}))) as { ok?: boolean; total?: number; truncated?: boolean; requested?: number; error?: string };
    if (!res.ok || body.ok === false) return { ok: false, error: body.error ?? `HTTP ${res.status}` };
    return { ok: true, total: body.total, truncated: body.truncated, requested: body.requested };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}

/** Recent broadcast runs for the org. Never throws. */
export async function fetchBroadcasts(token: string): Promise<BroadcastRow[]> {
  try {
    const res = await fetch(`${import.meta.env.VITE_GATEWAY_URL}/api/broadcasts`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = (await res.json().catch(() => ({}))) as { ok?: boolean; broadcasts?: BroadcastRow[] };
    if (!res.ok || body.ok === false) return [];
    return body.broadcasts ?? [];
  } catch {
    return [];
  }
}

/** Export current analytics to the connected sheet's report tab. Never throws. */
export async function exportAnalyticsToSheet(
  token: string
): Promise<{ ok: boolean; exported?: number; tab?: string; error?: string }> {
  try {
    const res = await fetch(`${import.meta.env.VITE_GATEWAY_URL}/api/integrations/google_sheets/export`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = (await res.json().catch(() => ({}))) as { ok?: boolean; exported?: number; tab?: string; error?: string };
    if (!res.ok || body.ok === false) return { ok: false, error: body.error ?? `HTTP ${res.status}` };
    return { ok: true, exported: body.exported, tab: body.tab };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}

/* ─── Data-driven marketing ─────────────────────────────────────── */

const GW = () => import.meta.env.VITE_GATEWAY_URL;
const authHeaders = (token: string) => ({ Authorization: `Bearer ${token}` });

export async function previewSegment(
  token: string,
  filter: SegmentFilter,
  channel: 'whatsapp' | 'email'
): Promise<{ count: number; sample: string[] }> {
  try {
    const res = await fetch(`${GW()}/api/segments/preview`, {
      method: 'POST',
      headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ filter, channel }),
    });
    const body = (await res.json().catch(() => ({}))) as { count?: number; sample?: string[] };
    return { count: body.count ?? 0, sample: body.sample ?? [] };
  } catch {
    return { count: 0, sample: [] };
  }
}

export async function createCampaign(
  token: string,
  input: {
    name: string;
    channel: 'whatsapp' | 'email';
    filter: SegmentFilter;
    templateKey?: string;
    emailSubject?: string;
    emailHtml?: string;
    targetUrl?: string;
  }
): Promise<{ ok: boolean; campaignId?: string; error?: string }> {
  try {
    const res = await fetch(`${GW()}/api/campaigns`, {
      method: 'POST',
      headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    const body = (await res.json().catch(() => ({}))) as { ok?: boolean; campaignId?: string; error?: string };
    if (!res.ok || body.ok === false) return { ok: false, error: body.error ?? `HTTP ${res.status}` };
    return { ok: true, campaignId: body.campaignId };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}

export async function fetchCampaigns(token: string): Promise<CampaignRow[]> {
  try {
    const res = await fetch(`${GW()}/api/campaigns`, { headers: authHeaders(token) });
    const body = (await res.json().catch(() => ({}))) as { ok?: boolean; campaigns?: CampaignRow[] };
    if (!res.ok || body.ok === false) return [];
    return body.campaigns ?? [];
  } catch {
    return [];
  }
}

export async function fetchCampaignDetail(
  token: string,
  id: string
): Promise<{ campaign: CampaignRow; stats: CampaignStats } | null> {
  try {
    const res = await fetch(`${GW()}/api/campaigns/${id}`, { headers: authHeaders(token) });
    const body = (await res.json().catch(() => ({}))) as { ok?: boolean; campaign?: CampaignRow; stats?: CampaignStats };
    if (!res.ok || body.ok === false || !body.campaign || !body.stats) return null;
    return { campaign: body.campaign, stats: body.stats };
  } catch {
    return null;
  }
}

export async function fetchMarketingOverview(token: string): Promise<MarketingOverview | null> {
  try {
    const res = await fetch(`${GW()}/api/marketing/overview`, { headers: authHeaders(token) });
    const body = (await res.json().catch(() => ({}))) as { ok?: boolean } & Partial<MarketingOverview>;
    if (!res.ok || body.ok === false || !body.stats) return null;
    return { stats: body.stats, topContacts: body.topContacts ?? [] };
  } catch {
    return null;
  }
}

export async function joinWaitlist(email: string, businessType: string | null): Promise<string | null> {
  const { error } = await supabase.from('waitlist').insert({
    email: email.trim(),
    business_type: businessType,
    source: 'landing',
  });
  if (error) return error.message;
  return null;
}
