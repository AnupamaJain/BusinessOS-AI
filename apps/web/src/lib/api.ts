import { supabase } from './supabase';
import type {
  AutomationRunItem,
  ContactRow,
  ConversationListItem,
  HandoffItem,
  HandoffReasonCount,
  KnowledgeDocRow,
  LeadItem,
  LlmModelUsage,
  LlmUsageSummary,
  MessageRow,
  MessageTemplateRow,
  Organization,
  PackageRow,
  ProductRow,
} from './types';

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
    .select('id, name, phone_number, email')
    .order('name', { ascending: true });
  if (error) throw new Error(`Failed to load contacts: ${error.message}`);
  return (data ?? []) as ContactRow[];
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
