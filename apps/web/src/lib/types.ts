/* ─── Shared app-level types (structural, independent of supabase-js) ── */

export interface AuthSession {
  access_token: string;
  user: {
    id: string;
    email?: string | null;
  };
}

export interface Organization {
  id: string;
  name: string;
}

export type ConversationStatus = 'active' | 'waiting_for_human' | 'resolved' | 'closed';

export interface ConversationListItem {
  id: string;
  contact_id: string | null;
  channel: string;
  status: ConversationStatus;
  created_at: string;
  contactName: string;
  contactPhone: string;
  lastMessage: string | null;
  lastMessageAt: string | null;
}

export interface MessageRow {
  id: string;
  conversation_id: string;
  direction: 'inbound' | 'outbound';
  message_type: string;
  content: string;
  created_at: string;
}

export type HandoffStatus = 'pending' | 'claimed' | 'resolved';

export interface HandoffItem {
  id: string;
  conversation_id: string;
  contact_id: string | null;
  reason: string;
  priority: string;
  status: HandoffStatus;
  summary: string | null;
  claimed_by: string | null;
  created_at: string;
  contactName: string;
  contactPhone: string;
}

export interface LeadItem {
  id: string;
  contact_id: string | null;
  stage: string;
  service_interest: string | null;
  score: number | null;
  qualification_summary: string | null;
  created_at: string;
  contactName: string;
  contactPhone: string;
}

export interface ContactRow {
  id: string;
  name: string | null;
  phone_number: string;
  email: string | null;
  tags?: string[] | null;
  preferred_language?: string | null;
  last_seen_at?: string | null;
}

/* Per-customer memory / operator note (Business Brain). */
export interface ContactNote {
  id: string;
  kind: 'memory' | 'note';
  body: string;
  created_at: string;
}

export interface ProductRow {
  id: string;
  sku: string;
  name: string;
  description: string | null;
  category: string | null;
  base_price: number | null;
  currency: string | null;
  status: string | null;
}

export interface PackageRow {
  id: string;
  sku: string;
  title: string;
  duration_days: number | null;
  price_per_person: number | null;
  currency: string | null;
  inclusions: unknown;
  status: string | null;
}

export interface KnowledgeDocRow {
  id: string;
  title: string;
  source_path: string | null;
  status: string | null;
}

export interface MessageTemplateRow {
  id: string;
  template_key: string;
  name: string;
  content: string | null;
  status: string | null;
}

/* Full template row (management UI: list + create). */
export interface MessageTemplateFull {
  id: string;
  template_key: string;
  name: string;
  content: string | null;
  language: string | null;
  status: string | null;
  category: string | null;
  created_at: string;
}

export type TemplateCategory = 'marketing' | 'utility' | 'authentication';

export interface CreateTemplateInput {
  organizationId: string;
  name: string;
  category: TemplateCategory;
  language: string;
  content: string;
}

export interface AutomationRunItem {
  id: string;
  contact_id: string | null;
  campaign_type: string;
  template_key: string | null;
  status: string;
  scheduled_for: string | null;
  contactName: string;
  contactPhone: string;
}

export interface LlmModelUsage {
  provider: string;
  model: string;
  requests: number;
  tokens: number;
  costUsd: number;
}

export interface LlmUsageSummary {
  totalRequests: number;
  totalTokens: number;
  totalCostUsd: number;
  byModel: LlmModelUsage[];
}

export interface HandoffReasonCount {
  reason: string;
  count: number;
}

/* ─── Dashboard KPIs (top strip) ──────────────────────────────────── */

export interface DashboardKpis {
  conversationsToday: number;
  qualifiedLeads: number;
  hotLeads: number;
  bookingsTotal: number;
  bookingsConfirmed: number;
  pendingPayments: number;
  revenuePipeline: number;
}

/* ─── Analytics: activity trend + lead funnel ─────────────────────── */

export interface ActivityTrendPoint {
  date: string; // UTC calendar date, YYYY-MM-DD
  messages: number;
  leads: number;
  bookings: number;
}

export interface LeadFunnelStage {
  stage: string;
  count: number;
}

/* ─── Billing / upgrade ───────────────────────────────────────────── */

export type BillingPlan = 'starter' | 'growth' | 'scale';

export interface CheckoutResult {
  ok: boolean;
  url?: string;
  error?: string;
}

/* ─── AI Team & Business Rules (agent config) ─────────────────────── */

export interface WorkingHours {
  start?: string;
  end?: string;
  timezone?: string;
}

export interface BusinessRules {
  maxDiscountPercent?: number;
  bookingRequiresPayment?: boolean;
  refundRequiresApproval?: boolean;
  workingHours?: WorkingHours;
  languages?: string[];
  tone?: string;
}

export interface AgentConfig {
  ok: boolean;
  rules?: BusinessRules;
  enabledAgents?: string[];
  error?: string;
}

export interface AgentTestResult {
  ok: boolean;
  reply?: string;
  intent?: string;
  error?: string;
}

/* ─── Customer Memory timeline ────────────────────────────────────── */

export interface TimelineEvent {
  at: string;
  icon: string;
  title: string;
  detail?: string;
}

/* ─── Platform admin: merchant management ─────────────────────────── */

export type MerchantStatus = 'active' | 'pending_review' | 'suspended';

export interface AdminMerchant {
  id: string;
  name: string;
  legalName?: string;
  onboardingStatus: string;
  createdAt: string;
}

export interface AdminMerchantsResult {
  ok: boolean;
  isAdmin: boolean;
  merchants: AdminMerchant[];
  error?: string;
}

/* ─── Per-tenant integrations (HubSpot, Instagram/Messenger) ──────── */

export type IntegrationProvider = 'hubspot' | 'instagram' | 'google_sheets';

export interface GoogleSheetsState {
  connected: boolean;
  /** Address the merchant must share their spreadsheet with. */
  serviceAccountEmail?: string;
  /** Whether the server has a service account configured at all. */
  available: boolean;
  spreadsheetId?: string;
  spreadsheetUrl?: string;
  title?: string;
  leadsTab: string;
  contactsTab: string;
  reportsTab: string;
  syncLeads: boolean;
}

export interface IntegrationsState {
  ok: boolean;
  hubspot: { connected: boolean };
  instagram: { connected: boolean; pageId?: string };
  googleSheets: GoogleSheetsState;
  error?: string;
}

export interface BroadcastRow {
  id: string;
  template_key: string;
  source: string | null;
  status: string;
  total: number;
  sent: number;
  failed: number;
  created_at: string;
  completed_at: string | null;
}

/* ─── Data-driven marketing (campaigns + analytics) ────────────────── */

export interface SegmentFilter {
  stages?: string[];
  minScore?: number;
  serviceInterest?: string;
  recencyDays?: number;
  requireEmail?: boolean;
}

export interface CampaignRow {
  id: string;
  name: string;
  channel: 'whatsapp' | 'email';
  status: string;
  total: number;
  sent: number;
  failed: number;
  created_at: string;
  sent_at: string | null;
  completed_at: string | null;
}

export interface CampaignStats {
  total: number;
  sent: number;
  delivered: number;
  opened: number;
  clicked: number;
  converted: number;
  deliveryRate: number;
  openRate: number;
  ctr: number;
  conversionRate: number;
}

export interface MarketingOverview {
  stats: CampaignStats;
  topContacts: Array<{ contactId: string; name: string; score: number }>;
}
