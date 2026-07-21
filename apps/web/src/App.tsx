import { useEffect, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import {
  MessageSquare,
  ShieldCheck,
  Calendar,
  BookOpen,
  Search,
  UserCheck,
  Send,
  CheckCircle,
  FileText,
  Copy,
  Clock,
  Settings,
  Globe,
  LogOut,
  BarChart3,
  Plus,
  CreditCard,
  Check,
  X,
} from 'lucide-react';
import { LandingPage } from './LandingPage';
import { useAuth } from './hooks/useAuth';
import { usePolling } from './hooks/usePolling';
import {
  claimHandoff,
  completeWhatsappSignup,
  createTemplate,
  fetchActivityTrend,
  fetchAutomationRuns,
  fetchContacts,
  fetchContactTimeline,
  fetchConversations,
  fetchDashboardKpis,
  fetchHandoffReasonCounts,
  fetchHandoffs,
  fetchKnowledgeDocs,
  fetchLeadFunnel,
  fetchLeads,
  fetchLlmUsageSummary,
  fetchMessages,
  fetchMessageTemplates,
  fetchOrganization,
  fetchPackages,
  fetchProducts,
  fetchTemplatesFull,
  queueAutomationRun,
  resolveConversation,
  resolveHandoff,
  sendOperatorMessage,
  startCheckout,
  updateOrganizationVertical,
  inviteTeamMember,
  acceptTeamInvite,
  saveMerchantProfile,
  connectPayment,
  connectUpi,
  acceptTerms,
  completeOnboarding,
} from './lib/api';
import { ActivityTrendChart, LeadFunnelChart } from './components/analyticsCharts';
import {
  getLastSignupInfo,
  launchWhatsAppSignup,
  loadFacebookSdk,
} from './lib/metaSignup';
import type {
  AuthSession,
  BillingPlan,
  DashboardKpis,
  HandoffItem,
  MessageRow,
  TemplateCategory,
  TimelineEvent,
} from './lib/types';

type ViewState = 'landing' | 'onboarding' | 'dashboard';
type TabKey = 'inbox' | 'crm' | 'scheduler' | 'compliance' | 'kb' | 'analytics';

const ERROR_COLOR = '#ff6b6b';

const BILLING_PLANS: Array<{
  plan: BillingPlan;
  name: string;
  price: string;
  tagline: string;
  featured?: boolean;
}> = [
  { plan: 'starter', name: 'Starter', price: '₹999', tagline: 'Solo operators getting started' },
  { plan: 'growth', name: 'Growth', price: '₹2,999', tagline: 'Growing support & sales teams', featured: true },
  { plan: 'scale', name: 'Scale', price: '₹7,999', tagline: 'High-volume, multi-operator orgs' },
];

/* ─── Small presentational helpers ────────────────────────────────── */

function StatusNote({ kind, children }: { kind: 'loading' | 'error' | 'empty'; children: ReactNode }) {
  return (
    <div
      style={{
        padding: '16px',
        fontSize: '13px',
        color: kind === 'error' ? ERROR_COLOR : 'var(--text-muted)',
      }}
    >
      {children}
    </div>
  );
}

function InlineBanner({ kind, children }: { kind: 'error' | 'success'; children: ReactNode }) {
  const color = kind === 'error' ? ERROR_COLOR : 'var(--color-success)';
  return (
    <div
      style={{
        padding: '10px 14px',
        borderRadius: '8px',
        border: `1px solid ${color}`,
        color,
        fontSize: '13px',
        marginBottom: '16px',
      }}
    >
      {children}
    </div>
  );
}

function FullScreenNote({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        backgroundColor: 'var(--bg-primary)',
        color: 'var(--text-muted)',
        fontSize: '14px',
      }}
    >
      {children}
    </div>
  );
}

function formatTime(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString([], {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatPrice(amount: number | null, currency: string | null): string {
  if (amount === null || amount === undefined || Number.isNaN(Number(amount))) return '—';
  const value = Number(amount).toLocaleString('en-IN');
  const cur = currency ?? 'INR';
  return cur === 'INR' ? `₹${value}` : `${cur} ${value}`;
}

function inclusionsText(value: unknown): string {
  if (Array.isArray(value)) return value.map(String).join(' • ');
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>)
      .map(String)
      .join(' • ');
  }
  return '';
}

/* ─── KPI strip (top of dashboard) ────────────────────────────────── */

function KpiTile({
  label,
  value,
  sub,
  subAccent,
}: {
  label: string;
  value: string;
  sub?: string;
  subAccent?: boolean;
}) {
  return (
    <div className="kpi-tile">
      <span className="kpi-label">{label}</span>
      <span className="kpi-value">{value}</span>
      {sub ? <span className={`kpi-sub${subAccent ? ' accent' : ''}`}>{sub}</span> : null}
    </div>
  );
}

function KpiStrip({
  data,
  loading,
}: {
  data: DashboardKpis | null;
  loading: boolean;
}) {
  const dash = !data && loading ? '—' : null;
  const num = (n: number): string => (dash !== null ? dash : n.toLocaleString('en-IN'));
  const revenue = dash !== null ? dash : `₹${(data?.revenuePipeline ?? 0).toLocaleString('en-IN')}`;

  return (
    <div className="kpi-strip">
      <KpiTile label="Conversations Today" value={num(data?.conversationsToday ?? 0)} />
      <KpiTile label="Qualified Leads" value={num(data?.qualifiedLeads ?? 0)} />
      <KpiTile
        label="Hot Leads"
        value={num(data?.hotLeads ?? 0)}
        sub="score ≥ 70"
        subAccent
      />
      <KpiTile
        label="Bookings"
        value={num(data?.bookingsTotal ?? 0)}
        sub={dash !== null ? undefined : `${data?.bookingsConfirmed ?? 0} confirmed / paid`}
      />
      <KpiTile label="Pending Payments" value={num(data?.pendingPayments ?? 0)} />
      <KpiTile
        label="Revenue Pipeline"
        value={revenue}
        sub="open bookings + orders"
      />
    </div>
  );
}

/* ─── Login screen ────────────────────────────────────────────────── */

function LoginScreen({
  onSignIn,
  onBackToSite,
}: {
  onSignIn: (email: string, password: string) => Promise<string | null>;
  onBackToSite: () => void;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    const message = await onSignIn(email.trim(), password);
    if (message) setError(message);
    setSubmitting(false);
  };

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        padding: '40px',
        backgroundColor: 'var(--bg-primary)',
      }}
    >
      <div
        className="report-card"
        style={{
          maxWidth: '420px',
          width: '100%',
          border: '1px solid var(--border-glow)',
          boxShadow: '0 0 30px rgba(0, 242, 254, 0.1)',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            justifyContent: 'center',
            marginBottom: '12px',
          }}
        >
          <img src="/saarthione-peacock-feather-v2.png" alt="SaarthiOne" width={40} height={40} style={{ borderRadius: '10px' }} />
          <span className="brand-logo" style={{ fontSize: '24px' }}>
            Saarthi<span style={{ color: 'var(--color-primary)' }}>One</span>
          </span>
        </div>
        <p
          style={{
            color: 'var(--text-muted)',
            fontSize: '13px',
            textAlign: 'center',
            marginBottom: '24px',
          }}
        >
          Sign in with your operator account to access the dashboard.
        </p>
        <form
          onSubmit={(e) => {
            void handleSubmit(e);
          }}
          style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}
        >
          <div className="form-group">
            <label className="form-label" htmlFor="login-email">
              Email
            </label>
            <input
              id="login-email"
              type="email"
              required
              autoComplete="email"
              className="form-input"
              style={{ width: '100%' }}
              placeholder="you@business.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="login-password">
              Password
            </label>
            <input
              id="login-password"
              type="password"
              required
              autoComplete="current-password"
              className="form-input"
              style={{ width: '100%' }}
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          {error && (
            <div
              style={{
                padding: '10px 14px',
                borderRadius: '8px',
                border: `1px solid ${ERROR_COLOR}`,
                color: ERROR_COLOR,
                fontSize: '13px',
              }}
            >
              {error}
            </div>
          )}
          <button
            type="submit"
            className="btn btn-primary"
            disabled={submitting}
            style={{ justifyContent: 'center' }}
          >
            {submitting ? 'Signing in…' : 'Sign In'}
          </button>
        </form>
        <button
          className="btn btn-secondary"
          style={{ marginTop: '16px', width: '100%', justifyContent: 'center' }}
          onClick={onBackToSite}
        >
          <Globe size={14} /> Back to website
        </button>
      </div>
    </div>
  );
}

/* ─── Root app: routing between landing / login / authed app ─────── */

export default function App() {
  const [viewState, setViewState] = useState<ViewState>('landing');
  const { session, loading, signIn, signOut } = useAuth();

  if (viewState === 'landing') {
    return (
      <LandingPage
        onLaunchApp={() => setViewState('dashboard')}
        onStartOnboarding={() => setViewState('onboarding')}
      />
    );
  }

  if (loading) {
    return <FullScreenNote>Checking session…</FullScreenNote>;
  }

  if (!session) {
    return <LoginScreen onSignIn={signIn} onBackToSite={() => setViewState('landing')} />;
  }

  return (
    <AuthedApp
      session={session}
      viewState={viewState}
      setViewState={setViewState}
      signOut={signOut}
    />
  );
}

/* ─── Authenticated application (onboarding wizard + dashboard) ───── */

interface AuthedAppProps {
  session: AuthSession;
  viewState: ViewState;
  setViewState: (view: ViewState) => void;
  signOut: () => Promise<void>;
}

interface LocalEcho {
  conversation_id: string;
  content: string;
  created_at: string;
}

function AuthedApp({ session, viewState, setViewState, signOut }: AuthedAppProps) {
  const [activeTab, setActiveTab] = useState<TabKey>('inbox');
  const [selectedConvId, setSelectedConvId] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [localEcho, setLocalEcho] = useState<LocalEcho[]>([]);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // Scheduler state
  const [scheduleContactId, setScheduleContactId] = useState('');
  const [scheduleTemplateKey, setScheduleTemplateKey] = useState('');
  const [scheduleAt, setScheduleAt] = useState('');
  const [scheduleBusy, setScheduleBusy] = useState(false);
  const [scheduleNotice, setScheduleNotice] = useState<{
    kind: 'success' | 'error';
    text: string;
  } | null>(null);

  // Template management state (scheduler tab)
  const [tplName, setTplName] = useState('');
  const [tplCategory, setTplCategory] = useState<TemplateCategory>('marketing');
  const [tplLanguage, setTplLanguage] = useState('en');
  const [tplContent, setTplContent] = useState('');
  const [tplBusy, setTplBusy] = useState(false);
  const [tplNotice, setTplNotice] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);

  // Billing / upgrade state (compliance tab)
  const [billingBusyPlan, setBillingBusyPlan] = useState<BillingPlan | null>(null);
  const [billingNotice, setBillingNotice] = useState<{
    kind: 'error' | 'success';
    text: string;
  } | null>(null);

  // Catalog search state
  const [searchQuery, setSearchQuery] = useState('');

  // Onboarding state
  const [onboardingStep, setOnboardingStep] = useState(1);
  const [selectedVertical, setSelectedVertical] = useState('travel');
  const [teamEmail, setTeamEmail] = useState('');
  const [invitedEmails, setInvitedEmails] = useState<string[]>([]);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [completingOnboarding, setCompletingOnboarding] = useState(false);
  const [onboardingIsNarrow, setOnboardingIsNarrow] = useState(false);

  // Onboarding Step 1 — business profile
  const [profileLegalName, setProfileLegalName] = useState('');
  const [profileBusinessType, setProfileBusinessType] = useState('Travel');
  const [profileContactName, setProfileContactName] = useState('');
  const [profileContactPhone, setProfileContactPhone] = useState('');
  const [profileCity, setProfileCity] = useState('');
  const [profileGst, setProfileGst] = useState('');
  const [profilePan, setProfilePan] = useState('');
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);

  // Onboarding Step 4 — payments (own Razorpay account)
  const [rzpKeyId, setRzpKeyId] = useState('');
  const [rzpKeySecret, setRzpKeySecret] = useState('');
  const [rzpWebhookSecret, setRzpWebhookSecret] = useState('');
  const [paymentConnecting, setPaymentConnecting] = useState(false);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [paymentMode, setPaymentMode] = useState<'test' | 'live' | null>(null);
  // Onboarding Step 4 — UPI (gateway-free) alternative
  const [upiVpa, setUpiVpa] = useState('');
  const [upiPayee, setUpiPayee] = useState('');
  const [upiConnecting, setUpiConnecting] = useState(false);
  const [upiError, setUpiError] = useState<string | null>(null);
  const [upiConnected, setUpiConnected] = useState(false);

  // Onboarding Step 7 — review & agree
  const [termsAgreed, setTermsAgreed] = useState(false);
  const [completeError, setCompleteError] = useState<string | null>(null);
  const [onboardingSubmitted, setOnboardingSubmitted] = useState(false);

  // WhatsApp Embedded Signup (onboarding Step 2)
  const [waConnecting, setWaConnecting] = useState(false);
  const [waError, setWaError] = useState<string | null>(null);
  const [waConnectedNumber, setWaConnectedNumber] = useState<string | null>(null);

  const metaAppId = import.meta.env.VITE_META_APP_ID;
  const metaConfigId = import.meta.env.VITE_META_CONFIG_ID;
  const embeddedSignupEnabled = Boolean(metaAppId) && Boolean(metaConfigId);

  const gatewayUrl = import.meta.env.VITE_GATEWAY_URL;
  const webhookUrl = gatewayUrl ? `${gatewayUrl}/webhook` : 'https://<your-gateway-domain>/webhook';

  async function handleConnectWhatsapp(): Promise<void> {
    if (!embeddedSignupEnabled) return;
    setWaError(null);
    setWaConnecting(true);
    try {
      await loadFacebookSdk(metaAppId);
      const { code } = await launchWhatsAppSignup(metaConfigId);
      const { phoneNumberId, wabaId } = getLastSignupInfo();
      const result = await completeWhatsappSignup(session.access_token, {
        code,
        phoneNumberId,
        wabaId,
      });
      if (result.ok) {
        setWaConnectedNumber(result.displayPhoneNumber ?? 'your WhatsApp number');
      } else {
        setWaError(result.error ?? 'Failed to connect WhatsApp');
      }
    } catch (err) {
      setWaError(err instanceof Error ? err.message : 'Failed to connect WhatsApp');
    } finally {
      setWaConnecting(false);
    }
  }

  /* Accept a team invite when the app is opened with ?invite=<token>. The
     signed-in user joins the inviting org, then we reload to pick up the new
     membership and drop the token from the URL. */
  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get('invite');
    if (!token) return;
    void acceptTeamInvite(session.access_token, token).then((r) => {
      const url = new URL(window.location.href);
      url.searchParams.delete('invite');
      window.history.replaceState({}, '', url.toString());
      if (r.ok) window.location.reload();
    });
    // Run once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* Responsive breakpoint for the onboarding wizard (drives compact layout) */
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(max-width: 480px)');
    const update = () => setOnboardingIsNarrow(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  const [invitingTeam, setInvitingTeam] = useState(false);

  async function handleAddInvite(): Promise<void> {
    const email = teamEmail.trim();
    if (!email) {
      setInviteError('Enter an email address to invite.');
      return;
    }
    const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRe.test(email)) {
      setInviteError('Enter a valid email address.');
      return;
    }
    if (invitedEmails.some((e) => e.toLowerCase() === email.toLowerCase())) {
      setInviteError('That email has already been invited.');
      return;
    }
    setInviteError(null);
    setInvitingTeam(true);
    // Really send the invite (gateway persists it + emails an accept link).
    const result = await inviteTeamMember(session.access_token, email, 'operator');
    setInvitingTeam(false);
    if (!result.ok) {
      setInviteError(result.error ?? 'Could not send the invite. Try again.');
      return;
    }
    setInvitedEmails([...invitedEmails, email]);
    setTeamEmail('');
  }

  const inDashboard = viewState === 'dashboard';
  const inboxActive = inDashboard && activeTab === 'inbox';
  const crmActive = inDashboard && activeTab === 'crm';
  const schedulerActive = inDashboard && activeTab === 'scheduler';
  const complianceActive = inDashboard && activeTab === 'compliance';
  const analyticsActive = inDashboard && activeTab === 'analytics';
  const kbActive =
    (inDashboard && activeTab === 'kb') || (viewState === 'onboarding' && onboardingStep === 5);

  /* Live data (10s polling while the relevant view is active) */
  const orgQuery = usePolling(fetchOrganization, [session.user.id], 60_000, true);
  const kpisQuery = usePolling(fetchDashboardKpis, [], 15_000, inDashboard);
  const conversationsQuery = usePolling(fetchConversations, [], 10_000, inboxActive);
  const handoffsQuery = usePolling(fetchHandoffs, [], 10_000, inboxActive);
  const messagesQuery = usePolling<MessageRow[]>(
    () => (selectedConvId ? fetchMessages(selectedConvId) : Promise.resolve([])),
    [selectedConvId],
    10_000,
    inboxActive && !!selectedConvId
  );
  const leadsQuery = usePolling(fetchLeads, [], 10_000, crmActive);
  const productsQuery = usePolling(fetchProducts, [], 10_000, crmActive);
  const packagesQuery = usePolling(fetchPackages, [], 10_000, crmActive);
  const kbDocsQuery = usePolling(fetchKnowledgeDocs, [], 10_000, kbActive);
  const contactsQuery = usePolling(fetchContacts, [], 10_000, schedulerActive);
  const templatesQuery = usePolling(fetchMessageTemplates, [], 10_000, schedulerActive);
  const templatesFullQuery = usePolling(fetchTemplatesFull, [], 15_000, schedulerActive);
  const runsQuery = usePolling(fetchAutomationRuns, [], 10_000, schedulerActive);
  const llmQuery = usePolling(fetchLlmUsageSummary, [], 10_000, complianceActive);
  const reasonsQuery = usePolling(fetchHandoffReasonCounts, [], 10_000, complianceActive);
  const activityTrendQuery = usePolling(fetchActivityTrend, [], 30_000, analyticsActive);
  const leadFunnelQuery = usePolling(fetchLeadFunnel, [], 30_000, analyticsActive);

  const org = orgQuery.data;
  const conversations = conversationsQuery.data ?? [];
  const handoffs = handoffsQuery.data ?? [];

  /* Auto-select the first conversation once loaded */
  useEffect(() => {
    const rows = conversationsQuery.data;
    if (!selectedConvId && rows && rows.length > 0) {
      setSelectedConvId(rows[0]?.id ?? null);
    }
  }, [conversationsQuery.data, selectedConvId]);

  /* Default the scheduler selects once options load */
  useEffect(() => {
    if (!scheduleContactId) {
      const first = contactsQuery.data?.[0];
      if (first) setScheduleContactId(first.id);
    }
  }, [contactsQuery.data, scheduleContactId]);

  useEffect(() => {
    if (!scheduleTemplateKey) {
      const first = templatesQuery.data?.[0];
      if (first) setScheduleTemplateKey(first.template_key);
    }
  }, [templatesQuery.data, scheduleTemplateKey]);

  const currentConv = conversations.find((c) => c.id === selectedConvId) ?? null;
  const currentHandoff =
    handoffs.find((h) => h.conversation_id === selectedConvId && h.status !== 'resolved') ?? null;

  const selectedContactId = currentConv?.contact_id ?? null;
  const orgId = org?.id ?? null;

  /* Per-merchant Razorpay webhook URL (shown on the payments onboarding step). */
  const razorpayWebhookUrl = `${gatewayUrl ?? 'https://<your-gateway-domain>'}/webhooks/razorpay/${
    orgId ?? '<your-org-id>'
  }`;

  async function handleSaveProfile(): Promise<void> {
    const required: Array<[string, string]> = [
      [profileLegalName, 'Legal / business name'],
      [profileContactName, 'Contact person'],
      [profileContactPhone, 'Contact phone'],
      [profileCity, 'City'],
    ];
    const missing = required.find(([value]) => !value.trim());
    if (missing) {
      setProfileError(`${missing[1]} is required.`);
      return;
    }
    setProfileError(null);
    setProfileSaving(true);
    const result = await saveMerchantProfile(session.access_token, {
      legalName: profileLegalName.trim(),
      businessType: profileBusinessType,
      contactName: profileContactName.trim(),
      contactPhone: profileContactPhone.trim(),
      city: profileCity.trim(),
      gstNumber: profileGst.trim() || undefined,
      pan: profilePan.trim() || undefined,
    });
    setProfileSaving(false);
    if (!result.ok) {
      setProfileError(result.error ?? 'Could not save your profile. Try again.');
      return;
    }
    setOnboardingStep(2);
  }

  async function handleConnectPayment(): Promise<void> {
    if (!rzpKeyId.trim() || !rzpKeySecret.trim()) {
      setPaymentError('Enter both your Razorpay Key ID and Key Secret.');
      return;
    }
    setPaymentError(null);
    setPaymentConnecting(true);
    const result = await connectPayment(session.access_token, {
      keyId: rzpKeyId.trim(),
      keySecret: rzpKeySecret.trim(),
      webhookSecret: rzpWebhookSecret.trim() || undefined,
    });
    setPaymentConnecting(false);
    if (!result.ok) {
      setPaymentError(result.error ?? 'Could not connect your Razorpay account.');
      return;
    }
    setPaymentMode(result.mode ?? 'test');
  }

  async function handleConnectUpi(): Promise<void> {
    const vpa = upiVpa.trim();
    if (!/^[\w.-]{2,}@[\w.-]{2,}$/.test(vpa)) {
      setUpiError('Enter a valid UPI ID, e.g. yourname@okhdfcbank');
      return;
    }
    setUpiError(null);
    setUpiConnecting(true);
    const result = await connectUpi(session.access_token, { upiVpa: vpa, payeeName: upiPayee.trim() || undefined });
    setUpiConnecting(false);
    if (!result.ok) {
      setUpiError(result.error ?? 'Could not save your UPI ID.');
      return;
    }
    setUpiConnected(true);
  }

  async function handleCompleteOnboarding(): Promise<void> {
    if (!termsAgreed) return;
    setCompleteError(null);
    setCompletingOnboarding(true);
    try {
      // Best-effort persistence of the chosen vertical; never block the user.
      if (orgId) {
        await updateOrganizationVertical(orgId, selectedVertical);
      }
      const terms = await acceptTerms(session.access_token, { termsVersion: 'v1-2026-07' });
      if (!terms.ok) {
        setCompleteError(terms.error ?? 'Could not record your agreement. Try again.');
        return;
      }
      const result = await completeOnboarding(session.access_token);
      if (!result.ok) {
        setCompleteError(result.error ?? 'Could not complete setup. Try again.');
        return;
      }
      if (result.status === 'pending_review') {
        setOnboardingSubmitted(true);
      } else {
        setViewState('dashboard');
      }
    } finally {
      setCompletingOnboarding(false);
    }
  }

  const timelineQuery = usePolling<TimelineEvent[]>(
    () =>
      selectedContactId && orgId
        ? fetchContactTimeline(selectedContactId, orgId)
        : Promise.resolve([]),
    [selectedContactId, orgId],
    15_000,
    inboxActive && !!selectedContactId && !!orgId
  );

  const fetchedMessages = messagesQuery.data ?? [];
  const visibleEchoes = selectedConvId
    ? localEcho.filter(
        (e) =>
          e.conversation_id === selectedConvId &&
          !fetchedMessages.some((m) => m.direction === 'outbound' && m.content === e.content)
      )
    : [];

  const pendingCount = handoffs.filter((h) => h.status === 'pending').length;
  const claimedCount = handoffs.filter((h) => h.status === 'claimed').length;
  const waitingCount = conversations.filter((c) => c.status === 'waiting_for_human').length;
  const activeConvCount = conversations.filter((c) => c.status === 'active').length;

  /* ─── Handlers ──────────────────────────────────────────────────── */

  const handleSendMessage = async () => {
    const text = replyText.trim();
    if (!text || !selectedConvId || sending) return;
    setSending(true);
    setSendError(null);
    try {
      await sendOperatorMessage(session.access_token, selectedConvId, text);
      setLocalEcho((prev) => [
        ...prev,
        { conversation_id: selectedConvId, content: text, created_at: new Date().toISOString() },
      ]);
      setReplyText('');
      await messagesQuery.refetch();
    } catch (err) {
      setSendError(err instanceof Error ? err.message : 'Failed to send message');
    } finally {
      setSending(false);
    }
  };

  const handleClaim = async (handoff: HandoffItem) => {
    setActionError(null);
    try {
      await claimHandoff(handoff.id, session.user.id);
      await handoffsQuery.refetch();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to claim handoff');
    }
  };

  const handleResolve = async () => {
    if (!selectedConvId || actionBusy) return;
    setActionBusy(true);
    setActionError(null);
    try {
      if (currentHandoff) {
        await resolveHandoff(currentHandoff.id);
      }
      await resolveConversation(selectedConvId);
      await Promise.all([handoffsQuery.refetch(), conversationsQuery.refetch()]);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to resolve ticket');
    } finally {
      setActionBusy(false);
    }
  };

  const handleScheduleCampaign = async (e: FormEvent) => {
    e.preventDefault();
    if (scheduleBusy) return;
    if (!org) {
      setScheduleNotice({ kind: 'error', text: 'Organization not loaded yet — try again.' });
      return;
    }
    if (!scheduleContactId || !scheduleTemplateKey || !scheduleAt) {
      setScheduleNotice({ kind: 'error', text: 'Select a contact, a template, and a time.' });
      return;
    }
    setScheduleBusy(true);
    setScheduleNotice(null);
    try {
      await queueAutomationRun({
        organizationId: org.id,
        contactId: scheduleContactId,
        templateKey: scheduleTemplateKey,
        scheduledForIso: new Date(scheduleAt).toISOString(),
      });
      setScheduleNotice({ kind: 'success', text: 'Campaign follow-up queued successfully.' });
      setScheduleAt('');
      await runsQuery.refetch();
    } catch (err) {
      setScheduleNotice({
        kind: 'error',
        text: err instanceof Error ? err.message : 'Failed to queue campaign',
      });
    } finally {
      setScheduleBusy(false);
    }
  };

  const handleCreateTemplate = async (e: FormEvent) => {
    e.preventDefault();
    if (tplBusy) return;
    if (!org) {
      setTplNotice({ kind: 'error', text: 'Organization not loaded yet — try again.' });
      return;
    }
    if (!tplName.trim() || !tplContent.trim()) {
      setTplNotice({ kind: 'error', text: 'Template name and content are required.' });
      return;
    }
    setTplBusy(true);
    setTplNotice(null);
    try {
      await createTemplate({
        organizationId: org.id,
        name: tplName,
        category: tplCategory,
        language: tplLanguage,
        content: tplContent,
      });
      setTplNotice({
        kind: 'success',
        text: 'Template created with status “pending”. Submit it to Meta for approval before sending.',
      });
      setTplName('');
      setTplContent('');
      await Promise.all([templatesFullQuery.refetch(), templatesQuery.refetch()]);
    } catch (err) {
      setTplNotice({
        kind: 'error',
        text: err instanceof Error ? err.message : 'Failed to create template',
      });
    } finally {
      setTplBusy(false);
    }
  };

  const handleUpgrade = async (plan: BillingPlan) => {
    if (billingBusyPlan) return;
    setBillingBusyPlan(plan);
    setBillingNotice(null);
    const result = await startCheckout(session.access_token, plan);
    if (result.ok && result.url) {
      window.location.href = result.url;
      return; // navigation in progress — keep the button in its busy state
    }
    setBillingNotice({
      kind: 'error',
      text: result.error ?? "Billing isn't enabled yet. Please try again later.",
    });
    setBillingBusyPlan(null);
  };

  /* CRM search filtering */
  const searchLower = searchQuery.toLowerCase();
  const filteredProducts = (productsQuery.data ?? []).filter(
    (p) =>
      p.name.toLowerCase().includes(searchLower) ||
      p.sku.toLowerCase().includes(searchLower) ||
      (p.description ?? '').toLowerCase().includes(searchLower)
  );
  const filteredPackages = (packagesQuery.data ?? []).filter(
    (p) =>
      p.title.toLowerCase().includes(searchLower) ||
      p.sku.toLowerCase().includes(searchLower) ||
      inclusionsText(p.inclusions).toLowerCase().includes(searchLower)
  );

  /* ─── Onboarding wizard ─────────────────────────────────────────── */

  if (viewState === 'onboarding' && onboardingSubmitted) {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '100vh',
          padding: onboardingIsNarrow ? '20px 12px' : '40px',
          backgroundColor: 'var(--bg-primary)',
        }}
      >
        <div
          className="report-card"
          style={{
            maxWidth: '520px',
            width: '100%',
            textAlign: 'center',
            border: '1px solid var(--border-glow)',
            boxShadow: '0 0 30px rgba(0, 242, 254, 0.1)',
          }}
        >
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>🎉</div>
          <h2
            style={{
              fontSize: '20px',
              fontWeight: 700,
              marginBottom: '12px',
              fontFamily: 'var(--font-heading)',
            }}
          >
            Submitted! Your account is under review
          </h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '14px', lineHeight: 1.5, marginBottom: '24px' }}>
            Thanks for setting up {profileLegalName.trim() || 'your business'}. Our team is reviewing
            your details — we&apos;ll email you at{' '}
            <span style={{ color: 'var(--text-main)', fontWeight: 600 }}>{session.user.email}</span>{' '}
            the moment your account is activated.
          </p>
          <button className="btn btn-secondary" onClick={() => setViewState('landing')}>
            Back to home
          </button>
        </div>
      </div>
    );
  }

  if (viewState === 'onboarding') {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '100vh',
          padding: onboardingIsNarrow ? '20px 12px' : '40px',
          backgroundColor: 'var(--bg-primary)',
        }}
      >
        <div
          className="report-card"
          style={{
            maxWidth: '600px',
            width: '100%',
            border: '1px solid var(--border-glow)',
            boxShadow: '0 0 30px rgba(0, 242, 254, 0.1)',
          }}
        >
          {/* Brand Section */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              justifyContent: 'center',
              marginBottom: '32px',
            }}
          >
            <img src="/saarthione-peacock-feather-v2.png" alt="SaarthiOne" width={44} height={44} style={{ borderRadius: '11px' }} />
            <span className="brand-logo" style={{ fontSize: '28px' }}>
              Saarthi<span style={{ color: 'var(--color-primary)' }}>One</span> <span style={{ color: 'var(--text-muted)', fontWeight: 500 }}>Onboarding</span>
            </span>
          </div>

          {/* Steps indicator */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              marginBottom: '12px',
              position: 'relative',
            }}
          >
            <div
              style={{
                position: 'absolute',
                top: '15px',
                left: '0',
                right: '0',
                height: '2px',
                backgroundColor: 'var(--border-muted)',
                zIndex: 0,
              }}
            />
            {[1, 2, 3, 4, 5, 6, 7].map((step) => {
              const stepLabels: Record<number, string> = {
                1: 'Business Profile',
                2: 'Choose Vertical',
                3: 'Connect WhatsApp',
                4: 'Connect Payments',
                5: 'Knowledge Base',
                6: 'Team Invites',
                7: 'Review & Agree',
              };
              const done = onboardingStep > step;
              const active = onboardingStep === step;
              return (
                <div
                  key={step}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    zIndex: 1,
                    gap: '8px',
                    flex: '0 1 auto',
                    minWidth: 0,
                  }}
                >
                  <div
                    style={{
                      width: '32px',
                      height: '32px',
                      flexShrink: 0,
                      borderRadius: '50%',
                      backgroundColor:
                        onboardingStep >= step ? 'var(--color-primary)' : 'var(--bg-tertiary)',
                      color: onboardingStep >= step ? '#000' : 'var(--text-muted)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontWeight: 'bold',
                      border: active ? '2px solid var(--text-main)' : 'none',
                      boxShadow: onboardingStep >= step ? '0 0 10px rgba(0, 242, 254, 0.3)' : 'none',
                    }}
                  >
                    {done ? <Check size={16} strokeWidth={3} /> : step}
                  </div>
                  {!onboardingIsNarrow && (
                    <span
                      style={{
                        fontSize: '11px',
                        fontWeight: 600,
                        textAlign: 'center',
                        lineHeight: 1.2,
                        color: onboardingStep >= step ? 'var(--text-main)' : 'var(--text-muted)',
                      }}
                    >
                      {stepLabels[step]}
                    </span>
                  )}
                </div>
              );
            })}
          </div>

          {/* Compact progress caption */}
          <div
            style={{
              fontSize: '12px',
              fontWeight: 600,
              color: 'var(--text-muted)',
              textAlign: 'center',
              marginBottom: '32px',
            }}
          >
            Step {onboardingStep} of 7 ·{' '}
            <span style={{ color: 'var(--color-primary)' }}>
              {(
                {
                  1: 'Business Profile',
                  2: 'Choose Vertical',
                  3: 'Connect WhatsApp',
                  4: 'Connect Payments',
                  5: 'Knowledge Base',
                  6: 'Team Invites',
                  7: 'Review & Agree',
                } as Record<number, string>
              )[onboardingStep] ?? ''}
            </span>
          </div>

          {/* Step Content */}
          {onboardingStep === 1 && (
            <div>
              <h2
                style={{
                  fontSize: '18px',
                  fontWeight: 600,
                  marginBottom: '16px',
                  fontFamily: 'var(--font-heading)',
                }}
              >
                Step 1: Tell Us About Your Business
              </h2>
              <p style={{ color: 'var(--text-muted)', fontSize: '13px', marginBottom: '24px' }}>
                This is the legal identity we&apos;ll use for your WhatsApp Business profile, invoices,
                and payment settlements. You can update these details later.
              </p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                <label style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)' }}>
                    Legal / business name <span style={{ color: 'var(--color-danger)' }}>*</span>
                  </span>
                  <input
                    className="chat-input"
                    placeholder="Acme Travels Pvt. Ltd."
                    value={profileLegalName}
                    onChange={(e) => {
                      setProfileLegalName(e.target.value);
                      if (profileError) setProfileError(null);
                    }}
                  />
                </label>

                <label style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)' }}>
                    Business type <span style={{ color: 'var(--color-danger)' }}>*</span>
                  </span>
                  <select
                    className="chat-input"
                    value={profileBusinessType}
                    onChange={(e) => setProfileBusinessType(e.target.value)}
                    style={{ appearance: 'auto' }}
                  >
                    {[
                      'Travel',
                      'Salon',
                      'Clinic',
                      'Restaurant',
                      'Education',
                      'Retail',
                      'Intercity Cab',
                      'Home Services',
                      'Other',
                    ].map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </select>
                </label>

                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: onboardingIsNarrow ? '1fr' : '1fr 1fr',
                    gap: '14px',
                  }}
                >
                  <label style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)' }}>
                      Contact person <span style={{ color: 'var(--color-danger)' }}>*</span>
                    </span>
                    <input
                      className="chat-input"
                      placeholder="Priya Sharma"
                      value={profileContactName}
                      onChange={(e) => {
                        setProfileContactName(e.target.value);
                        if (profileError) setProfileError(null);
                      }}
                    />
                  </label>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)' }}>
                      Contact phone <span style={{ color: 'var(--color-danger)' }}>*</span>
                    </span>
                    <input
                      className="chat-input"
                      placeholder="+91 98765 43210"
                      value={profileContactPhone}
                      onChange={(e) => {
                        setProfileContactPhone(e.target.value);
                        if (profileError) setProfileError(null);
                      }}
                    />
                  </label>
                </div>

                <label style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)' }}>
                    City <span style={{ color: 'var(--color-danger)' }}>*</span>
                  </span>
                  <input
                    className="chat-input"
                    placeholder="Jaipur"
                    value={profileCity}
                    onChange={(e) => {
                      setProfileCity(e.target.value);
                      if (profileError) setProfileError(null);
                    }}
                  />
                </label>

                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: onboardingIsNarrow ? '1fr' : '1fr 1fr',
                    gap: '14px',
                  }}
                >
                  <label style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)' }}>
                      GST number <span style={{ color: 'var(--text-muted)' }}>(optional)</span>
                    </span>
                    <input
                      className="chat-input"
                      placeholder="22AAAAA0000A1Z5"
                      value={profileGst}
                      onChange={(e) => setProfileGst(e.target.value)}
                    />
                  </label>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)' }}>
                      PAN <span style={{ color: 'var(--text-muted)' }}>(optional)</span>
                    </span>
                    <input
                      className="chat-input"
                      placeholder="AAAAA0000A"
                      value={profilePan}
                      onChange={(e) => setProfilePan(e.target.value)}
                    />
                  </label>
                </div>
              </div>

              {profileError && (
                <div style={{ fontSize: '12px', color: 'var(--color-danger)', marginTop: '16px' }}>
                  {profileError}
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '32px' }}>
                <button
                  className="btn btn-primary"
                  disabled={profileSaving}
                  style={{
                    opacity: profileSaving ? 0.6 : 1,
                    cursor: profileSaving ? 'not-allowed' : 'pointer',
                  }}
                  onClick={() => {
                    void handleSaveProfile();
                  }}
                >
                  {profileSaving ? 'Saving…' : 'Next: Choose Vertical'}
                </button>
              </div>
            </div>
          )}

          {onboardingStep === 2 && (
            <div>
              <h2
                style={{
                  fontSize: '18px',
                  fontWeight: 600,
                  marginBottom: '16px',
                  fontFamily: 'var(--font-heading)',
                }}
              >
                Step 2: Choose Your Business Vertical Template
              </h2>
              <p style={{ color: 'var(--text-muted)', fontSize: '13px', marginBottom: '24px' }}>
                Templates include pre-configured intent classifiers, RAG boundaries, and
                auto-followup triggers.
              </p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                {[
                  {
                    id: 'travel',
                    title: 'Travel & Tourism',
                    recommended: true,
                    desc: 'AI Travel Planner, holiday package quotes, flight & hotel inquiries, and visa guidelines.',
                  },
                  {
                    id: 'd2c-skincare',
                    title: 'D2C Skincare & Personal Care',
                    recommended: false,
                    desc: 'Skincare catalog, return policies, medical exclusions, and automated follow-ups.',
                  },
                  {
                    id: 'cab-intercity',
                    title: 'Intercity Cab / Taxi',
                    recommended: false,
                    desc: 'City-to-city routes, fare quotes by vehicle class, pickup scheduling, and payment links.',
                  },
                  {
                    id: 'home-services',
                    title: 'Home & Maid Services',
                    recommended: false,
                    desc: 'Cooking, cleaning & full-time plans, area matching, one-time or monthly booking, and payments.',
                  },
                  {
                    id: 'custom',
                    title: 'Other / General Business',
                    recommended: false,
                    desc: 'Start with a blank template — configure intents and knowledge later.',
                  },
                ].map((v) => {
                  const selected = selectedVertical === v.id;
                  return (
                    <div
                      key={v.id}
                      role="button"
                      tabIndex={0}
                      aria-pressed={selected}
                      onClick={() => setSelectedVertical(v.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          setSelectedVertical(v.id);
                        }
                      }}
                      style={{
                        position: 'relative',
                        padding: '16px',
                        paddingRight: '44px',
                        borderRadius: '12px',
                        backgroundColor: selected
                          ? 'rgba(0, 242, 254, 0.08)'
                          : 'var(--bg-tertiary)',
                        border: selected
                          ? '2px solid var(--color-primary)'
                          : '1px solid var(--border-muted)',
                        boxShadow: selected ? '0 0 12px rgba(0, 242, 254, 0.15)' : 'none',
                        cursor: 'pointer',
                        transition: 'border-color 0.15s, background-color 0.15s',
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px',
                          fontWeight: 600,
                          fontSize: '15px',
                          color: selected ? 'var(--color-primary)' : 'var(--text-main)',
                          marginBottom: '4px',
                        }}
                      >
                        {v.title}
                        {v.recommended && (
                          <span
                            style={{
                              fontSize: '10px',
                              fontWeight: 700,
                              textTransform: 'uppercase',
                              letterSpacing: '0.04em',
                              color: 'var(--color-primary)',
                              border: '1px solid var(--color-primary)',
                              borderRadius: '6px',
                              padding: '1px 6px',
                            }}
                          >
                            Recommended
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{v.desc}</div>
                      <div
                        style={{
                          position: 'absolute',
                          top: '16px',
                          right: '16px',
                          width: '20px',
                          height: '20px',
                          borderRadius: '50%',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          backgroundColor: selected ? 'var(--color-primary)' : 'transparent',
                          border: selected
                            ? '2px solid var(--color-primary)'
                            : '2px solid var(--border-muted)',
                          color: '#000',
                        }}
                      >
                        {selected && <Check size={12} strokeWidth={3} />}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  marginTop: '32px',
                }}
              >
                <button className="btn btn-secondary" onClick={() => setOnboardingStep(1)}>
                  Back
                </button>
                <button className="btn btn-primary" onClick={() => setOnboardingStep(3)}>
                  Next: Connect WhatsApp
                </button>
              </div>
            </div>
          )}

          {onboardingStep === 3 && (
            <div>
              <h2
                style={{
                  fontSize: '18px',
                  fontWeight: 600,
                  marginBottom: '16px',
                  fontFamily: 'var(--font-heading)',
                }}
              >
                Step 3: Connect Your WhatsApp Business Account
              </h2>
              <p style={{ color: 'var(--text-muted)', fontSize: '13px', marginBottom: '24px' }}>
                Connect your WhatsApp Business Account in a few clicks — Meta&apos;s secure signup
                popup provisions your number and wires up messaging automatically. Prefer to do it by
                hand? The manual webhook details are below.
              </p>

              {/* Meta WhatsApp Embedded Signup */}
              <div
                style={{
                  padding: '20px',
                  backgroundColor: 'rgba(0, 242, 254, 0.05)',
                  borderRadius: '12px',
                  border: '1px solid var(--color-primary)',
                  marginBottom: '20px',
                }}
              >
                {waConnectedNumber ? (
                  <div>
                    <div
                      style={{
                        fontSize: '15px',
                        fontWeight: 600,
                        color: 'var(--color-success)',
                        marginBottom: '4px',
                      }}
                    >
                      ✅ WhatsApp connected: {waConnectedNumber}
                    </div>
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                      Inbound messages will now flow into your Operator Inbox. You can proceed to the
                      next step.
                    </div>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <div style={{ fontSize: '13px', color: 'var(--text-main)', fontWeight: 600 }}>
                      Self-serve connection
                    </div>
                    <div>
                      <button
                        className="btn btn-primary"
                        disabled={!embeddedSignupEnabled || waConnecting}
                        style={{
                          opacity: !embeddedSignupEnabled || waConnecting ? 0.6 : 1,
                          cursor:
                            !embeddedSignupEnabled || waConnecting ? 'not-allowed' : 'pointer',
                        }}
                        onClick={() => {
                          void handleConnectWhatsapp();
                        }}
                      >
                        {waConnecting
                          ? '⏳ Connecting…'
                          : '🔗 Connect WhatsApp Business Account'}
                      </button>
                    </div>
                    {waError && (
                      <div style={{ fontSize: '12px', color: 'var(--color-danger)' }}>
                        {waError}
                      </div>
                    )}
                    {!embeddedSignupEnabled && (
                      <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                        Self-serve WhatsApp connect activates once Meta Embedded Signup is configured
                        (VITE_META_APP_ID / VITE_META_CONFIG_ID).
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div
                style={{
                  fontSize: '12px',
                  fontWeight: 600,
                  color: 'var(--text-muted)',
                  marginBottom: '12px',
                }}
              >
                Or configure the webhook manually
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div
                  style={{
                    padding: '16px',
                    backgroundColor: 'var(--bg-tertiary)',
                    borderRadius: '12px',
                    border: '1px solid var(--border-muted)',
                  }}
                >
                  <div
                    style={{
                      fontSize: '12px',
                      fontWeight: 600,
                      color: 'var(--text-muted)',
                      marginBottom: '8px',
                    }}
                  >
                    Webhook Callback URL
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      gap: '8px',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                    }}
                  >
                    <code style={{ fontSize: '13px', wordBreak: 'break-all' }}>{webhookUrl}</code>
                    <button
                      className="btn btn-secondary"
                      style={{ padding: '6px 12px', fontSize: '12px', flexShrink: 0 }}
                      onClick={() => {
                        void navigator.clipboard.writeText(webhookUrl);
                      }}
                    >
                      <Copy size={12} /> Copy
                    </button>
                  </div>
                </div>

                <div
                  style={{
                    padding: '16px',
                    backgroundColor: 'var(--bg-tertiary)',
                    borderRadius: '12px',
                    border: '1px solid var(--border-muted)',
                  }}
                >
                  <div
                    style={{
                      fontSize: '12px',
                      fontWeight: 600,
                      color: 'var(--text-muted)',
                      marginBottom: '8px',
                    }}
                  >
                    Verify Token
                  </div>
                  <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
                    The verify token is configured server-side on the gateway via the{' '}
                    <code>META_VERIFY_TOKEN</code> environment variable. Enter that same value in
                    Meta's webhook configuration dialog.
                  </div>
                </div>

                <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                  Required OAuth permissions: <code>whatsapp_business_management</code>,{' '}
                  <code>whatsapp_business_messaging</code>.
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '32px' }}>
                <button className="btn btn-secondary" onClick={() => setOnboardingStep(2)}>
                  Back
                </button>
                <button className="btn btn-primary" onClick={() => setOnboardingStep(4)}>
                  Next: Connect Payments
                </button>
              </div>
            </div>
          )}

          {onboardingStep === 4 && (
            <div>
              <h2
                style={{
                  fontSize: '18px',
                  fontWeight: 600,
                  marginBottom: '16px',
                  fontFamily: 'var(--font-heading)',
                }}
              >
                Step 4: Connect Payments
              </h2>
              <p style={{ color: 'var(--text-muted)', fontSize: '13px', marginBottom: '24px' }}>
                Connect your <strong>own</strong> Razorpay account so payments go directly to you. Use{' '}
                <code>rzp_test_</code> keys to try it in sandbox, <code>rzp_live_</code> for
                production. This step is optional — you can set it up later.
              </p>

              <div
                style={{
                  padding: '20px',
                  backgroundColor: paymentMode ? 'rgba(0, 242, 254, 0.05)' : 'var(--bg-tertiary)',
                  borderRadius: '12px',
                  border: paymentMode
                    ? '1px solid var(--color-primary)'
                    : '1px solid var(--border-muted)',
                  marginBottom: '20px',
                }}
              >
                {paymentMode ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <div
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '8px',
                        alignSelf: 'flex-start',
                        fontSize: '13px',
                        fontWeight: 700,
                        color: 'var(--color-success)',
                        border: '1px solid var(--color-success)',
                        borderRadius: '8px',
                        padding: '4px 10px',
                      }}
                    >
                      <Check size={14} strokeWidth={3} /> Connected ({paymentMode} mode)
                    </div>
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                      Payments will settle directly to your Razorpay account. You can proceed to the
                      next step.
                    </div>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      <span
                        style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)' }}
                      >
                        Razorpay Key ID <span style={{ color: 'var(--color-danger)' }}>*</span>
                      </span>
                      <input
                        className="chat-input"
                        placeholder="rzp_test_XXXXXXXXXXXX"
                        value={rzpKeyId}
                        onChange={(e) => {
                          setRzpKeyId(e.target.value);
                          if (paymentError) setPaymentError(null);
                        }}
                      />
                    </label>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      <span
                        style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)' }}
                      >
                        Key Secret <span style={{ color: 'var(--color-danger)' }}>*</span>
                      </span>
                      <input
                        className="chat-input"
                        type="password"
                        placeholder="••••••••••••••••"
                        value={rzpKeySecret}
                        onChange={(e) => {
                          setRzpKeySecret(e.target.value);
                          if (paymentError) setPaymentError(null);
                        }}
                      />
                    </label>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      <span
                        style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)' }}
                      >
                        Webhook secret <span style={{ color: 'var(--text-muted)' }}>(optional)</span>
                      </span>
                      <input
                        className="chat-input"
                        type="password"
                        placeholder="Razorpay webhook signing secret"
                        value={rzpWebhookSecret}
                        onChange={(e) => setRzpWebhookSecret(e.target.value)}
                      />
                    </label>
                    {paymentError && (
                      <div style={{ fontSize: '12px', color: 'var(--color-danger)' }}>
                        {paymentError}
                      </div>
                    )}
                    <div>
                      <button
                        className="btn btn-primary"
                        disabled={paymentConnecting}
                        style={{
                          opacity: paymentConnecting ? 0.6 : 1,
                          cursor: paymentConnecting ? 'not-allowed' : 'pointer',
                        }}
                        onClick={() => {
                          void handleConnectPayment();
                        }}
                      >
                        {paymentConnecting ? '⏳ Connecting…' : '🔗 Connect Razorpay'}
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <div
                style={{
                  padding: '16px',
                  backgroundColor: 'var(--bg-tertiary)',
                  borderRadius: '12px',
                  border: '1px solid var(--border-muted)',
                  marginBottom: '8px',
                }}
              >
                <div
                  style={{
                    fontSize: '12px',
                    fontWeight: 600,
                    color: 'var(--text-muted)',
                    marginBottom: '8px',
                  }}
                >
                  Your Razorpay webhook URL
                </div>
                <div
                  style={{
                    display: 'flex',
                    gap: '8px',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                >
                  <code style={{ fontSize: '13px', wordBreak: 'break-all' }}>{razorpayWebhookUrl}</code>
                  <button
                    className="btn btn-secondary"
                    style={{ padding: '6px 12px', fontSize: '12px', flexShrink: 0 }}
                    onClick={() => {
                      void navigator.clipboard.writeText(razorpayWebhookUrl);
                    }}
                  >
                    <Copy size={12} /> Copy
                  </button>
                </div>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '8px' }}>
                  Add this as a webhook in your Razorpay dashboard so we can reconcile payments.
                </div>
              </div>

              {/* ── OR: accept UPI directly (gateway-free) ── */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', margin: '22px 0 14px' }}>
                <div style={{ flex: 1, height: '1px', backgroundColor: 'var(--border-muted)' }} />
                <span style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 600 }}>OR ACCEPT UPI DIRECTLY</span>
                <div style={{ flex: 1, height: '1px', backgroundColor: 'var(--border-muted)' }} />
              </div>
              <div style={{ padding: '18px', backgroundColor: 'var(--bg-tertiary)', borderRadius: '12px', border: upiConnected ? '1px solid var(--color-success)' : '1px solid var(--border-muted)' }}>
                {upiConnected ? (
                  <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--color-success)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Check size={16} strokeWidth={3} /> UPI ID connected — {upiVpa.trim()}
                  </div>
                ) : (
                  <>
                    <div style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '12px' }}>
                      No gateway needed — customers pay by UPI straight into your ID (GPay / PhonePe / Paytm). Zero fees.
                      Note: UPI payments don’t auto-confirm, so you’ll mark bookings as paid once the money reflects.
                    </div>
                    <input
                      type="text"
                      className="chat-input"
                      placeholder="Your UPI ID — e.g. yourname@okhdfcbank"
                      value={upiVpa}
                      onChange={(e) => { setUpiVpa(e.target.value); if (upiError) setUpiError(null); }}
                      style={{ width: '100%', marginBottom: '10px' }}
                    />
                    <input
                      type="text"
                      className="chat-input"
                      placeholder="Payee name shown to customers (optional)"
                      value={upiPayee}
                      onChange={(e) => setUpiPayee(e.target.value)}
                      style={{ width: '100%', marginBottom: '12px' }}
                    />
                    {upiError && (
                      <div style={{ fontSize: '12px', color: 'var(--color-danger)', marginBottom: '10px' }}>{upiError}</div>
                    )}
                    <button className="btn btn-secondary" disabled={upiConnecting} onClick={() => { void handleConnectUpi(); }}>
                      {upiConnecting ? '⏳ Saving…' : '💸 Save UPI ID'}
                    </button>
                  </>
                )}
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '32px', gap: '12px', flexWrap: 'wrap' }}>
                <button className="btn btn-secondary" onClick={() => setOnboardingStep(3)}>
                  Back
                </button>
                <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                  <button
                    className="btn btn-secondary"
                    onClick={() => setOnboardingStep(5)}
                  >
                    Skip for now — set up later
                  </button>
                  <button className="btn btn-primary" onClick={() => setOnboardingStep(5)}>
                    Next: Knowledge Base
                  </button>
                </div>
              </div>
            </div>
          )}

          {onboardingStep === 5 && (
            <div>
              <h2
                style={{
                  fontSize: '18px',
                  fontWeight: 600,
                  marginBottom: '16px',
                  fontFamily: 'var(--font-heading)',
                }}
              >
                Step 5: Knowledge Base Status
              </h2>
              <p style={{ color: 'var(--text-muted)', fontSize: '13px', marginBottom: '24px' }}>
                These documents are ingested into the retrieval index and ground every AI answer.
                Documents are managed via the gateway ingestion pipeline.
              </p>

              {kbDocsQuery.loading && !kbDocsQuery.data && (
                <StatusNote kind="loading">Loading knowledge documents…</StatusNote>
              )}
              {kbDocsQuery.error && <StatusNote kind="error">{kbDocsQuery.error}</StatusNote>}
              {kbDocsQuery.data && kbDocsQuery.data.length === 0 && (
                <StatusNote kind="empty">
                  No knowledge documents ingested yet. Run the ingestion pipeline on the gateway to
                  seed your knowledge base.
                </StatusNote>
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {(kbDocsQuery.data ?? []).map((doc) => (
                  <div
                    key={doc.id}
                    style={{
                      padding: '10px 16px',
                      backgroundColor: 'var(--bg-tertiary)',
                      borderRadius: '8px',
                      border: '1px solid var(--border-muted)',
                      fontSize: '12px',
                      display: 'flex',
                      justifyContent: 'space-between',
                      gap: '12px',
                    }}
                  >
                    <code>{doc.title}</code>
                    <span
                      style={{
                        color:
                          doc.status === 'ready' || doc.status === 'ingested'
                            ? 'var(--color-success)'
                            : 'var(--color-primary)',
                        fontWeight: 600,
                        textTransform: 'capitalize',
                      }}
                    >
                      {doc.status ?? 'unknown'}
                    </span>
                  </div>
                ))}
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '32px' }}>
                <button className="btn btn-secondary" onClick={() => setOnboardingStep(4)}>
                  Back
                </button>
                <button className="btn btn-primary" onClick={() => setOnboardingStep(6)}>
                  Next: Invite Team Members
                </button>
              </div>
            </div>
          )}

          {onboardingStep === 6 && (
            <div>
              <h2
                style={{
                  fontSize: '18px',
                  fontWeight: 600,
                  marginBottom: '16px',
                  fontFamily: 'var(--font-heading)',
                }}
              >
                Step 6: Invite Support & Sales Operators
              </h2>
              <p style={{ color: 'var(--text-muted)', fontSize: '13px', marginBottom: '24px' }}>
                Invite team members to manage your inbox queue, claim handoffs, and monitor safety
                logs. Each teammate gets an email with a secure link to join your workspace.
              </p>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void handleAddInvite();
                }}
                style={{ display: 'flex', gap: '12px', marginBottom: inviteError ? '8px' : '20px' }}
              >
                <input
                  type="email"
                  placeholder="operator@mybusiness.com"
                  className="chat-input"
                  value={teamEmail}
                  onChange={(e) => {
                    setTeamEmail(e.target.value);
                    if (inviteError) setInviteError(null);
                  }}
                />
                <button type="submit" className="btn btn-secondary" disabled={invitingTeam}>
                  {invitingTeam ? 'Sending…' : 'Invite'}
                </button>
              </form>

              {inviteError && (
                <div
                  style={{
                    fontSize: '12px',
                    color: 'var(--color-danger)',
                    marginBottom: '20px',
                  }}
                >
                  {inviteError}
                </div>
              )}

              {invitedEmails.length > 0 && (
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '8px',
                    marginBottom: '24px',
                  }}
                >
                  <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)' }}>
                    Pending Invites:
                  </div>
                  {invitedEmails.map((email, idx) => (
                    <div
                      key={email}
                      style={{
                        padding: '8px 12px',
                        backgroundColor: 'var(--bg-tertiary)',
                        borderRadius: '8px',
                        border: '1px solid var(--border-muted)',
                        fontSize: '12px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        justifyContent: 'space-between',
                      }}
                    >
                      <span style={{ wordBreak: 'break-all' }}>{email}</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>
                        <span style={{ color: 'var(--color-warning)', fontWeight: 600 }}>
                          Invite sent
                        </span>
                        <button
                          type="button"
                          aria-label={`Remove ${email}`}
                          title="Remove invite"
                          onClick={() =>
                            setInvitedEmails(invitedEmails.filter((_, i) => i !== idx))
                          }
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            width: '22px',
                            height: '22px',
                            borderRadius: '50%',
                            background: 'transparent',
                            border: '1px solid var(--border-muted)',
                            color: 'var(--text-muted)',
                            cursor: 'pointer',
                            padding: 0,
                          }}
                        >
                          <X size={12} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '32px' }}>
                <button
                  className="btn btn-secondary"
                  onClick={() => setOnboardingStep(5)}
                >
                  Back
                </button>
                <button
                  className="btn btn-primary"
                  onClick={() => setOnboardingStep(7)}
                >
                  Next: Review &amp; Agree
                </button>
              </div>
            </div>
          )}

          {onboardingStep === 7 && (
            <div>
              <h2
                style={{
                  fontSize: '18px',
                  fontWeight: 600,
                  marginBottom: '16px',
                  fontFamily: 'var(--font-heading)',
                }}
              >
                Step 7: Review &amp; Agree
              </h2>
              <p style={{ color: 'var(--text-muted)', fontSize: '13px', marginBottom: '24px' }}>
                Here&apos;s a summary of what you&apos;ve set up. Confirm the details and agree to our
                terms to finish.
              </p>

              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '10px',
                  padding: '16px',
                  backgroundColor: 'var(--bg-tertiary)',
                  borderRadius: '12px',
                  border: '1px solid var(--border-muted)',
                  marginBottom: '20px',
                }}
              >
                {[
                  { label: 'Business name', value: profileLegalName.trim() || '—' },
                  { label: 'Business type', value: profileBusinessType },
                  {
                    label: 'Vertical template',
                    value: selectedVertical,
                  },
                  {
                    label: 'WhatsApp',
                    value: waConnectedNumber ? `Connected · ${waConnectedNumber}` : 'Not connected',
                    ok: Boolean(waConnectedNumber),
                  },
                  {
                    label: 'Payments',
                    value: paymentMode ? `Connected · ${paymentMode} mode` : 'Not connected',
                    ok: Boolean(paymentMode),
                  },
                ].map((row) => (
                  <div
                    key={row.label}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      gap: '12px',
                      fontSize: '13px',
                    }}
                  >
                    <span style={{ color: 'var(--text-muted)', flexShrink: 0 }}>{row.label}</span>
                    <span
                      style={{
                        fontWeight: 600,
                        textAlign: 'right',
                        wordBreak: 'break-word',
                        color:
                          'ok' in row
                            ? row.ok
                              ? 'var(--color-success)'
                              : 'var(--text-muted)'
                            : 'var(--text-main)',
                      }}
                    >
                      {row.value}
                    </span>
                  </div>
                ))}
              </div>

              <label
                style={{
                  display: 'flex',
                  gap: '10px',
                  alignItems: 'flex-start',
                  padding: '14px 16px',
                  backgroundColor: termsAgreed ? 'rgba(0, 242, 254, 0.06)' : 'var(--bg-tertiary)',
                  borderRadius: '12px',
                  border: termsAgreed
                    ? '1px solid var(--color-primary)'
                    : '1px solid var(--border-muted)',
                  cursor: 'pointer',
                }}
              >
                <input
                  type="checkbox"
                  checked={termsAgreed}
                  onChange={(e) => {
                    setTermsAgreed(e.target.checked);
                    if (completeError) setCompleteError(null);
                  }}
                  style={{ marginTop: '2px', flexShrink: 0, width: '16px', height: '16px' }}
                />
                <span style={{ fontSize: '13px', color: 'var(--text-main)' }}>
                  I agree to the Terms of Service and confirm I have consent to message my customers
                  on WhatsApp.
                </span>
              </label>

              {completeError && (
                <div style={{ fontSize: '12px', color: 'var(--color-danger)', marginTop: '12px' }}>
                  {completeError}
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '32px' }}>
                <button
                  className="btn btn-secondary"
                  disabled={completingOnboarding}
                  onClick={() => setOnboardingStep(6)}
                >
                  Back
                </button>
                <button
                  className="btn btn-primary"
                  disabled={!termsAgreed || completingOnboarding}
                  style={{
                    opacity: !termsAgreed || completingOnboarding ? 0.6 : 1,
                    cursor: !termsAgreed || completingOnboarding ? 'not-allowed' : 'pointer',
                  }}
                  onClick={() => {
                    void handleCompleteOnboarding();
                  }}
                >
                  {completingOnboarding ? 'Submitting…' : 'Complete setup'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  /* ─── Dashboard ─────────────────────────────────────────────────── */

  return (
    <div className="dashboard-container">
      {/* ─── Sidebar ──────────────────────────────────────────────── */}
      <aside className="sidebar">
        <div
          className="brand-section"
          onClick={() => setViewState('landing')}
          style={{ cursor: 'pointer' }}
        >
          <img src="/saarthione-peacock-feather-v2.png" alt="SaarthiOne" width={30} height={30} style={{ borderRadius: '8px', flexShrink: 0 }} />
          <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.15, minWidth: 0 }}>
            <span className="brand-logo" style={{ letterSpacing: '-0.5px' }}>
              Saarthi<span style={{ color: 'var(--color-primary)' }}>One</span>
            </span>
            <span style={{ fontSize: '11px', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {orgQuery.loading && !org ? 'Loading…' : org?.name ?? ''}
            </span>
          </div>
        </div>

        <nav className="nav-links">
          <div
            className={`nav-item ${activeTab === 'inbox' ? 'active' : ''}`}
            onClick={() => setActiveTab('inbox')}
          >
            <MessageSquare className="nav-icon" />
            <span>Operator Inbox</span>
          </div>

          <div
            className={`nav-item ${activeTab === 'crm' ? 'active' : ''}`}
            onClick={() => setActiveTab('crm')}
          >
            <UserCheck className="nav-icon" />
            <span>CRM & Catalog</span>
          </div>

          <div
            className={`nav-item ${activeTab === 'scheduler' ? 'active' : ''}`}
            onClick={() => setActiveTab('scheduler')}
          >
            <Calendar className="nav-icon" />
            <span>Campaign Scheduler</span>
          </div>

          <div
            className={`nav-item ${activeTab === 'analytics' ? 'active' : ''}`}
            onClick={() => setActiveTab('analytics')}
          >
            <BarChart3 className="nav-icon" />
            <span>Analytics</span>
          </div>

          <div
            className={`nav-item ${activeTab === 'compliance' ? 'active' : ''}`}
            onClick={() => setActiveTab('compliance')}
          >
            <ShieldCheck className="nav-icon" />
            <span>AI Usage & Safety</span>
          </div>

          <div
            className={`nav-item ${activeTab === 'kb' ? 'active' : ''}`}
            onClick={() => setActiveTab('kb')}
          >
            <BookOpen className="nav-icon" />
            <span>Knowledge Base</span>
          </div>
        </nav>

        <div
          className="nav-item"
          style={{ marginTop: 'auto', borderLeft: 'none', color: 'var(--color-primary)' }}
          onClick={() => setViewState('landing')}
        >
          <Globe className="nav-icon" />
          <span>Website & Landing</span>
        </div>

        <div
          className="nav-item"
          style={{ borderLeft: 'none' }}
          onClick={() => {
            if (confirm('Relaunch the Onboarding Wizard?')) {
              setOnboardingStep(1);
              setViewState('onboarding');
            }
          }}
        >
          <Settings className="nav-icon" />
          <span>Onboarding Wizard</span>
        </div>
      </aside>

      {/* ─── Main Content ─────────────────────────────────────────── */}
      <main className="main-content">
        <header className="top-header">
          <h1 className="header-title">
            {activeTab === 'inbox' && 'Escalated Handoff Queue'}
            {activeTab === 'crm' && 'CRM Context & Product Directory'}
            {activeTab === 'scheduler' && 'Consent-Safe Auto Campaigns'}
            {activeTab === 'compliance' && 'AI Usage & Safety Observability'}
            {activeTab === 'analytics' && 'Activity Analytics & Lead Funnel'}
            {activeTab === 'kb' && 'RAG Knowledge Directory'}
          </h1>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <span className="tenant-badge">
              {org ? `Org: ${org.name}` : 'Org: SaarthiOne'}
            </span>
            <button
              className="btn btn-secondary"
              style={{ padding: '8px 14px', fontSize: '12px' }}
              onClick={() => {
                void signOut();
              }}
            >
              <LogOut size={14} /> Sign out
            </button>
          </div>
        </header>

        {/* ─── KPI strip (all tabs) ───────────────────────────────── */}
        <KpiStrip data={kpisQuery.data} loading={kpisQuery.loading} />

        {/* ─── Tab View: Operator Inbox ───────────────────────────── */}
        {activeTab === 'inbox' && (
          <>
            <div className="metrics-grid">
              <div className="metric-card">
                <div className="metric-header">
                  <span className="metric-label">Handoff Queue</span>
                  <div className="metric-icon-wrapper">
                    <Clock size={16} />
                  </div>
                </div>
                <span className="metric-value">{pendingCount + claimedCount}</span>
                <span className={`metric-footer ${pendingCount > 0 ? 'warning' : 'success'}`}>
                  {pendingCount} pending / {claimedCount} claimed
                </span>
              </div>

              <div className="metric-card">
                <div className="metric-header">
                  <span className="metric-label">Waiting for Human</span>
                  <div className="metric-icon-wrapper">
                    <UserCheck size={16} />
                  </div>
                </div>
                <span className="metric-value">{waitingCount}</span>
                <span className={`metric-footer ${waitingCount > 0 ? 'warning' : 'success'}`}>
                  {waitingCount > 0 ? 'Operators needed' : 'Queue clear'}
                </span>
              </div>

              <div className="metric-card">
                <div className="metric-header">
                  <span className="metric-label">Active Conversations</span>
                  <div className="metric-icon-wrapper">
                    <MessageSquare size={16} />
                  </div>
                </div>
                <span className="metric-value">{activeConvCount}</span>
                <span className="metric-footer success">AI handling autonomously</span>
              </div>

              <div className="metric-card">
                <div className="metric-header">
                  <span className="metric-label">Total Conversations</span>
                  <div className="metric-icon-wrapper">
                    <ShieldCheck size={16} />
                  </div>
                </div>
                <span className="metric-value">{conversations.length}</span>
                <span className="metric-footer success">Across all channels</span>
              </div>
            </div>

            {actionError && <InlineBanner kind="error">{actionError}</InlineBanner>}
            {conversationsQuery.error && (
              <InlineBanner kind="error">{conversationsQuery.error}</InlineBanner>
            )}
            {handoffsQuery.error && <InlineBanner kind="error">{handoffsQuery.error}</InlineBanner>}

            <div className="inbox-workspace">
              {/* Left Inbox List */}
              <div className="chat-list-pane">
                <div className="pane-header">Operator Queue</div>
                <div className="chat-items">
                  {handoffsQuery.loading && !handoffsQuery.data && (
                    <StatusNote kind="loading">Loading handoffs…</StatusNote>
                  )}
                  {handoffsQuery.data && handoffs.length === 0 && (
                    <StatusNote kind="empty">No pending handoffs. All clear.</StatusNote>
                  )}
                  {handoffs.map((h) => (
                    <div
                      key={h.id}
                      className={`chat-item ${h.conversation_id === selectedConvId ? 'active' : ''}`}
                      onClick={() => setSelectedConvId(h.conversation_id)}
                    >
                      <div className="chat-item-header">
                        <span className="chat-item-name">{h.contactName}</span>
                        <span className={`priority-tag ${h.priority}`}>{h.priority}</span>
                      </div>
                      <span className="chat-item-snippet">
                        {h.summary ?? h.reason.replace(/_/g, ' ')}
                      </span>
                      <div
                        style={{
                          marginTop: '8px',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px',
                        }}
                      >
                        <span
                          style={{
                            fontSize: '11px',
                            color: 'var(--text-muted)',
                            textTransform: 'capitalize',
                          }}
                        >
                          {h.reason.replace(/_/g, ' ')}
                        </span>
                        {h.status === 'pending' ? (
                          <button
                            className="btn btn-secondary"
                            style={{ padding: '4px 10px', fontSize: '11px', marginLeft: 'auto' }}
                            onClick={(e) => {
                              e.stopPropagation();
                              void handleClaim(h);
                            }}
                          >
                            <UserCheck size={12} /> Claim
                          </button>
                        ) : (
                          <span
                            style={{
                              fontSize: '11px',
                              color: 'var(--color-success)',
                              marginLeft: 'auto',
                            }}
                          >
                            {h.claimed_by === session.user.id ? 'Claimed by you' : 'Claimed'}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}

                  <div
                    className="pane-header"
                    style={{ borderTop: '1px solid var(--border-muted)' }}
                  >
                    All Conversations
                  </div>
                  {conversationsQuery.loading && !conversationsQuery.data && (
                    <StatusNote kind="loading">Loading conversations…</StatusNote>
                  )}
                  {conversationsQuery.data && conversations.length === 0 && (
                    <StatusNote kind="empty">No conversations yet.</StatusNote>
                  )}
                  {conversations.map((c) => (
                    <div
                      key={c.id}
                      className={`chat-item ${c.id === selectedConvId ? 'active' : ''}`}
                      onClick={() => setSelectedConvId(c.id)}
                    >
                      <div className="chat-item-header">
                        <span className="chat-item-name">{c.contactName}</span>
                        <span
                          style={{
                            fontSize: '10px',
                            color: 'var(--text-muted)',
                            textTransform: 'capitalize',
                          }}
                        >
                          {c.status.replace(/_/g, ' ')}
                        </span>
                      </div>
                      <span className="chat-item-snippet">
                        {c.lastMessage ?? 'No messages yet'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Center Chat View */}
              <div className="chat-area-pane">
                <div className="pane-header">
                  <div
                    style={{
                      display: 'flex',
                      justifySelf: 'space-between',
                      width: '100%',
                      alignItems: 'center',
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 600 }}>
                        {currentConv?.contactName ?? 'Select a conversation'}
                      </div>
                      <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                        {currentConv?.contactPhone ?? ''}
                        {currentConv ? ` • ${currentConv.status.replace(/_/g, ' ')}` : ''}
                      </div>
                    </div>
                    <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px' }}>
                      <button
                        className="btn btn-secondary"
                        disabled={!currentConv || actionBusy}
                        onClick={() => {
                          void handleResolve();
                        }}
                      >
                        <CheckCircle size={16} /> {actionBusy ? 'Resolving…' : 'Resolve Ticket'}
                      </button>
                    </div>
                  </div>
                </div>

                <div className="chat-messages">
                  {messagesQuery.loading && !messagesQuery.data && selectedConvId && (
                    <StatusNote kind="loading">Loading messages…</StatusNote>
                  )}
                  {messagesQuery.error && (
                    <StatusNote kind="error">{messagesQuery.error}</StatusNote>
                  )}
                  {messagesQuery.data &&
                    fetchedMessages.length === 0 &&
                    visibleEchoes.length === 0 && (
                      <StatusNote kind="empty">No messages in this conversation yet.</StatusNote>
                    )}
                  {fetchedMessages.map((m) => (
                    <div key={m.id} className={`message-bubble ${m.direction}`}>
                      {m.content}
                      <div
                        style={{
                          fontSize: '10px',
                          marginTop: '4px',
                          opacity: 0.6,
                          textAlign: m.direction === 'outbound' ? 'right' : 'left',
                        }}
                      >
                        {formatTime(m.created_at)}
                      </div>
                    </div>
                  ))}
                  {visibleEchoes.map((e, idx) => (
                    <div key={`echo-${idx}`} className="message-bubble outbound">
                      {e.content}
                      <div
                        style={{
                          fontSize: '10px',
                          marginTop: '4px',
                          opacity: 0.6,
                          textAlign: 'right',
                        }}
                      >
                        {formatTime(e.created_at)} • sending
                      </div>
                    </div>
                  ))}
                </div>

                {sendError && (
                  <div
                    style={{
                      padding: '8px 16px',
                      color: ERROR_COLOR,
                      fontSize: '12px',
                    }}
                  >
                    {sendError}
                  </div>
                )}

                <div className="chat-input-bar">
                  <input
                    type="text"
                    placeholder={
                      currentConv
                        ? 'Type message directly to client...'
                        : 'Select a conversation first'
                    }
                    className="chat-input"
                    value={replyText}
                    disabled={!currentConv || sending}
                    onChange={(e) => setReplyText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        void handleSendMessage();
                      }
                    }}
                  />
                  <button
                    className="btn btn-primary"
                    disabled={!currentConv || sending || !replyText.trim()}
                    onClick={() => {
                      void handleSendMessage();
                    }}
                  >
                    <Send size={16} /> {sending ? 'Sending…' : 'Send'}
                  </button>
                </div>
              </div>

              {/* Right Customer Memory Timeline */}
              <div className="memory-panel">
                <div className="memory-panel-header">
                  🧠 Customer Memory
                  <span className="memory-contact">
                    {currentConv ? currentConv.contactName : 'Select a conversation'}
                  </span>
                </div>
                <div className="memory-list">
                  {!selectedConvId && (
                    <StatusNote kind="empty">
                      Select a conversation to view the customer's history.
                    </StatusNote>
                  )}
                  {selectedConvId && timelineQuery.loading && !timelineQuery.data && (
                    <StatusNote kind="loading">Loading customer memory…</StatusNote>
                  )}
                  {selectedConvId && timelineQuery.error && (
                    <StatusNote kind="error">{timelineQuery.error}</StatusNote>
                  )}
                  {selectedConvId &&
                    timelineQuery.data &&
                    timelineQuery.data.length === 0 &&
                    !timelineQuery.loading && (
                      <StatusNote kind="empty">
                        No history yet — this is a new customer.
                      </StatusNote>
                    )}
                  {selectedConvId &&
                    (timelineQuery.data ?? []).map((ev, idx) => (
                      <div className="memory-event" key={`${ev.at}-${idx}`}>
                        <span className="memory-dot" />
                        <div className="memory-time">{formatDateTime(ev.at)}</div>
                        <div className="memory-title">
                          {ev.icon} {ev.title}
                        </div>
                        {ev.detail && <div className="memory-detail">{ev.detail}</div>}
                      </div>
                    ))}
                </div>
              </div>
            </div>
          </>
        )}

        {/* ─── Tab View: CRM & Catalog ────────────────────────────── */}
        {activeTab === 'crm' && (
          <div className="report-workspace">
            {/* Qualified CRM Leads */}
            <div className="report-card" style={{ width: '100%' }}>
              <div className="report-card-title">
                <UserCheck size={20} style={{ color: 'var(--color-primary)' }} />
                CRM Leads Database
              </div>
              {leadsQuery.loading && !leadsQuery.data && (
                <StatusNote kind="loading">Loading leads…</StatusNote>
              )}
              {leadsQuery.error && <StatusNote kind="error">{leadsQuery.error}</StatusNote>}
              <table className="compliance-table">
                <thead>
                  <tr>
                    <th>Customer Name</th>
                    <th>Phone</th>
                    <th>Interest Area</th>
                    <th>Qualification Score</th>
                    <th>Stage</th>
                    <th>Summary</th>
                  </tr>
                </thead>
                <tbody>
                  {leadsQuery.data && leadsQuery.data.length === 0 && (
                    <tr>
                      <td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
                        No leads captured yet.
                      </td>
                    </tr>
                  )}
                  {(leadsQuery.data ?? []).map((l) => (
                    <tr key={l.id}>
                      <td>{l.contactName}</td>
                      <td>{l.contactPhone}</td>
                      <td>{l.service_interest ?? '—'}</td>
                      <td>
                        {l.score === null ? (
                          <span style={{ color: 'var(--text-muted)' }}>—</span>
                        ) : (
                          <strong
                            style={{
                              color:
                                l.score >= 50 ? 'var(--color-success)' : 'var(--color-warning)',
                            }}
                          >
                            {l.score}/100
                          </strong>
                        )}
                      </td>
                      <td>
                        <span className="status-badge pass">{l.stage}</span>
                      </td>
                      <td style={{ fontStyle: 'italic', color: 'var(--text-muted)' }}>
                        {l.qualification_summary ?? '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Catalog searcher */}
            <div className="report-card" style={{ width: '100%' }}>
              <div className="report-card-title">
                <Search size={20} style={{ color: 'var(--color-primary)' }} />
                Product & Package Directory
              </div>
              <div style={{ marginBottom: '24px', position: 'relative' }}>
                <input
                  type="text"
                  placeholder="Search catalog by name, SKU, description..."
                  className="chat-input"
                  style={{ width: '100%', paddingLeft: '40px' }}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
                <Search
                  size={16}
                  style={{
                    position: 'absolute',
                    left: '16px',
                    top: '16px',
                    color: 'var(--text-muted)',
                  }}
                />
              </div>

              {productsQuery.loading && !productsQuery.data && (
                <StatusNote kind="loading">Loading products…</StatusNote>
              )}
              {productsQuery.error && <StatusNote kind="error">{productsQuery.error}</StatusNote>}
              {productsQuery.data && filteredProducts.length === 0 && !searchQuery && (
                <StatusNote kind="empty">No products in the catalog yet.</StatusNote>
              )}
              <div className="catalog-grid" style={{ margin: 0 }}>
                {filteredProducts.map((p) => (
                  <div className="product-item-card" key={p.id}>
                    <span className="product-sku">{p.sku}</span>
                    <span className="product-name">{p.name}</span>
                    <span className="product-price">{formatPrice(p.base_price, p.currency)}</span>
                    <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
                      {p.category ?? 'Uncategorized'}
                      {p.status ? ` • ${p.status}` : ''}
                    </div>
                    <div style={{ fontSize: '12px', marginTop: '8px' }}>{p.description ?? ''}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Travel packages */}
            <div className="report-card" style={{ width: '100%' }}>
              <div className="report-card-title">
                <Globe size={20} style={{ color: 'var(--color-primary)' }} />
                Travel Packages
              </div>
              {packagesQuery.loading && !packagesQuery.data && (
                <StatusNote kind="loading">Loading packages…</StatusNote>
              )}
              {packagesQuery.error && <StatusNote kind="error">{packagesQuery.error}</StatusNote>}
              {packagesQuery.data && filteredPackages.length === 0 && !searchQuery && (
                <StatusNote kind="empty">No travel packages published yet.</StatusNote>
              )}
              <div className="catalog-grid" style={{ margin: 0 }}>
                {filteredPackages.map((p) => (
                  <div className="product-item-card" key={p.id}>
                    <span className="product-sku">{p.sku}</span>
                    <span className="product-name">{p.title}</span>
                    <span className="product-price">
                      {formatPrice(p.price_per_person, p.currency)}
                      {p.price_per_person !== null ? ' / person' : ''}
                    </span>
                    <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
                      {p.duration_days !== null ? `${p.duration_days} days` : 'Flexible duration'}
                      {p.status ? ` • ${p.status}` : ''}
                    </div>
                    <div style={{ fontSize: '12px', marginTop: '8px' }}>
                      {inclusionsText(p.inclusions)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ─── Tab View: Campaign Scheduler ───────────────────────── */}
        {activeTab === 'scheduler' && (
          <>
            <div className="scheduler-card">
              <div className="report-card-title">
                <Calendar size={20} style={{ color: 'var(--color-primary)' }} />
                Schedule Automated Follow-up Trigger
              </div>

              {scheduleNotice && (
                <InlineBanner kind={scheduleNotice.kind}>{scheduleNotice.text}</InlineBanner>
              )}
              {contactsQuery.error && (
                <InlineBanner kind="error">{contactsQuery.error}</InlineBanner>
              )}
              {templatesQuery.error && (
                <InlineBanner kind="error">{templatesQuery.error}</InlineBanner>
              )}

              <form
                onSubmit={(e) => {
                  void handleScheduleCampaign(e);
                }}
                style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}
              >
                <div className="form-group">
                  <label className="form-label">Select Customer</label>
                  <select
                    className="form-select"
                    value={scheduleContactId}
                    onChange={(e) => setScheduleContactId(e.target.value)}
                  >
                    <option value="" disabled>
                      {contactsQuery.loading && !contactsQuery.data
                        ? 'Loading contacts…'
                        : 'Select a contact'}
                    </option>
                    {(contactsQuery.data ?? []).map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name ?? c.phone_number} ({c.phone_number})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="form-group">
                  <label className="form-label">Approved Template</label>
                  <select
                    className="form-select"
                    value={scheduleTemplateKey}
                    onChange={(e) => setScheduleTemplateKey(e.target.value)}
                  >
                    <option value="" disabled>
                      {templatesQuery.loading && !templatesQuery.data
                        ? 'Loading templates…'
                        : 'Select a template'}
                    </option>
                    {(templatesQuery.data ?? []).map((t) => (
                      <option key={t.id} value={t.template_key}>
                        {t.template_key}
                        {t.status ? ` (${t.status})` : ''}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="form-group">
                  <label className="form-label">Scheduled For</label>
                  <input
                    type="datetime-local"
                    className="form-input"
                    value={scheduleAt}
                    onChange={(e) => setScheduleAt(e.target.value)}
                  />
                </div>

                <button
                  type="submit"
                  className="btn btn-primary"
                  style={{ alignSelf: 'flex-start' }}
                  disabled={scheduleBusy}
                >
                  <CheckCircle size={16} /> {scheduleBusy ? 'Queueing…' : 'Queue Campaign Flow'}
                </button>
              </form>
            </div>

            {/* Scheduled Campaign queue */}
            <div className="scheduler-card" style={{ marginTop: 0 }}>
              <div className="report-card-title">Automation Runs</div>
              {runsQuery.loading && !runsQuery.data && (
                <StatusNote kind="loading">Loading automation runs…</StatusNote>
              )}
              {runsQuery.error && <StatusNote kind="error">{runsQuery.error}</StatusNote>}
              <table className="compliance-table">
                <thead>
                  <tr>
                    <th>Contact</th>
                    <th>Campaign</th>
                    <th>Template</th>
                    <th>Scheduled For</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {runsQuery.data && runsQuery.data.length === 0 ? (
                    <tr>
                      <td colSpan={5} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
                        No campaigns currently queued. Use the form above to queue a trigger.
                      </td>
                    </tr>
                  ) : (
                    (runsQuery.data ?? []).map((r) => (
                      <tr key={r.id}>
                        <td>{r.contactName}</td>
                        <td>
                          <code>{r.campaign_type}</code>
                        </td>
                        <td>
                          <code>{r.template_key ?? '—'}</code>
                        </td>
                        <td>{formatDateTime(r.scheduled_for)}</td>
                        <td>
                          <span className="status-badge pass">{r.status}</span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* Message template management */}
            <div className="scheduler-card" style={{ marginTop: 0 }}>
              <div className="report-card-title">
                <FileText size={20} style={{ color: 'var(--color-primary)' }} />
                WhatsApp Message Templates
              </div>

              {tplNotice && <InlineBanner kind={tplNotice.kind}>{tplNotice.text}</InlineBanner>}
              {templatesFullQuery.error && (
                <InlineBanner kind="error">{templatesFullQuery.error}</InlineBanner>
              )}

              <form
                onSubmit={(e) => {
                  void handleCreateTemplate(e);
                }}
                style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}
              >
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                    gap: '20px',
                  }}
                >
                  <div className="form-group">
                    <label className="form-label" htmlFor="tpl-name">
                      Template Name
                    </label>
                    <input
                      id="tpl-name"
                      type="text"
                      className="form-input"
                      placeholder="e.g. Booking reminder"
                      value={tplName}
                      onChange={(e) => setTplName(e.target.value)}
                    />
                  </div>

                  <div className="form-group">
                    <label className="form-label" htmlFor="tpl-category">
                      Category
                    </label>
                    <select
                      id="tpl-category"
                      className="form-select"
                      value={tplCategory}
                      onChange={(e) => setTplCategory(e.target.value as TemplateCategory)}
                    >
                      <option value="marketing">Marketing</option>
                      <option value="utility">Utility</option>
                      <option value="authentication">Authentication</option>
                    </select>
                  </div>

                  <div className="form-group">
                    <label className="form-label" htmlFor="tpl-language">
                      Language
                    </label>
                    <input
                      id="tpl-language"
                      type="text"
                      className="form-input"
                      placeholder="en"
                      value={tplLanguage}
                      onChange={(e) => setTplLanguage(e.target.value)}
                    />
                  </div>
                </div>

                <div className="form-group">
                  <label className="form-label" htmlFor="tpl-content">
                    Content
                  </label>
                  <textarea
                    id="tpl-content"
                    className="form-input"
                    style={{ minHeight: '96px', resize: 'vertical', fontFamily: 'var(--font-body)' }}
                    placeholder="Hi {{1}}, your booking is confirmed for {{2}}. Reply STOP to opt out."
                    value={tplContent}
                    onChange={(e) => setTplContent(e.target.value)}
                  />
                  <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                    New templates are saved as <strong>pending</strong> — WhatsApp templates must be
                    approved by Meta before they can be sent.
                  </span>
                </div>

                <button
                  type="submit"
                  className="btn btn-primary"
                  style={{ alignSelf: 'flex-start' }}
                  disabled={tplBusy}
                >
                  <Plus size={16} /> {tplBusy ? 'Creating…' : 'Create Template'}
                </button>
              </form>

              {templatesFullQuery.loading && !templatesFullQuery.data && (
                <StatusNote kind="loading">Loading templates…</StatusNote>
              )}
              <table className="compliance-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Key</th>
                    <th>Category</th>
                    <th>Language</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {templatesFullQuery.data && templatesFullQuery.data.length === 0 && (
                    <tr>
                      <td colSpan={5} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
                        No templates yet. Create one above to get started.
                      </td>
                    </tr>
                  )}
                  {(templatesFullQuery.data ?? []).map((t) => {
                    const status = t.status ?? 'pending';
                    const color =
                      status === 'approved'
                        ? 'var(--color-success)'
                        : status === 'rejected'
                          ? 'var(--color-danger)'
                          : 'var(--color-warning)';
                    return (
                      <tr key={t.id}>
                        <td>{t.name}</td>
                        <td>
                          <code>{t.template_key}</code>
                        </td>
                        <td style={{ textTransform: 'capitalize' }}>{t.category ?? '—'}</td>
                        <td>{t.language ?? 'en'}</td>
                        <td>
                          <span
                            className="status-badge"
                            style={{
                              color,
                              backgroundColor: 'rgba(255,255,255,0.04)',
                              border: `1px solid ${color}`,
                              textTransform: 'capitalize',
                            }}
                          >
                            {status}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}

        {/* ─── Tab View: AI Usage & Safety ────────────────────────── */}
        {activeTab === 'compliance' && (
          <div className="report-workspace">
            {/* Plan / billing */}
            <div className="report-card" style={{ width: '100%' }}>
              <div className="report-card-title">
                <CreditCard size={20} style={{ color: 'var(--color-primary)' }} />
                Plan & Billing
              </div>
              <p style={{ color: 'var(--text-muted)', fontSize: '13px', marginTop: '-12px', marginBottom: '20px' }}>
                Upgrade your subscription. Prices shown are ₹999 / ₹2,999 / ₹7,999 per month.
              </p>

              {billingNotice && (
                <InlineBanner kind={billingNotice.kind}>{billingNotice.text}</InlineBanner>
              )}

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                  gap: '20px',
                }}
              >
                {BILLING_PLANS.map((p) => (
                  <div
                    key={p.plan}
                    style={{
                      padding: '24px',
                      borderRadius: '16px',
                      backgroundColor: p.featured ? 'rgba(0, 242, 254, 0.05)' : 'var(--bg-tertiary)',
                      border: p.featured
                        ? '1px solid var(--color-primary)'
                        : '1px solid var(--border-muted)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '10px',
                    }}
                  >
                    <span
                      style={{
                        fontSize: '13px',
                        fontWeight: 700,
                        letterSpacing: '0.5px',
                        textTransform: 'uppercase',
                        color: p.featured ? 'var(--color-primary)' : 'var(--text-muted)',
                      }}
                    >
                      {p.name}
                    </span>
                    <span
                      style={{
                        fontFamily: 'var(--font-heading)',
                        fontSize: '28px',
                        fontWeight: 700,
                      }}
                    >
                      {p.price}
                      <span style={{ fontSize: '13px', fontWeight: 400, color: 'var(--text-muted)' }}>
                        {' '}
                        / month
                      </span>
                    </span>
                    <span style={{ fontSize: '12px', color: 'var(--text-muted)', flex: 1 }}>
                      {p.tagline}
                    </span>
                    <button
                      className={p.featured ? 'btn btn-primary' : 'btn btn-secondary'}
                      style={{ justifyContent: 'center' }}
                      disabled={billingBusyPlan !== null}
                      onClick={() => {
                        void handleUpgrade(p.plan);
                      }}
                    >
                      {billingBusyPlan === p.plan ? 'Redirecting…' : 'Upgrade'}
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <div className="report-card" style={{ width: '100%' }}>
              <div className="report-card-title">
                <ShieldCheck size={20} style={{ color: 'var(--color-success)' }} />
                LLM Usage Summary
              </div>
              {llmQuery.loading && !llmQuery.data && (
                <StatusNote kind="loading">Loading usage metrics…</StatusNote>
              )}
              {llmQuery.error && <StatusNote kind="error">{llmQuery.error}</StatusNote>}
              <div className="metrics-grid">
                <div className="metric-card">
                  <div className="metric-header">
                    <span className="metric-label">Total Requests</span>
                    <div className="metric-icon-wrapper">
                      <MessageSquare size={16} />
                    </div>
                  </div>
                  <span className="metric-value">{llmQuery.data?.totalRequests ?? 0}</span>
                  <span className="metric-footer success">LLM calls recorded</span>
                </div>
                <div className="metric-card">
                  <div className="metric-header">
                    <span className="metric-label">Total Tokens</span>
                    <div className="metric-icon-wrapper">
                      <FileText size={16} />
                    </div>
                  </div>
                  <span className="metric-value">
                    {(llmQuery.data?.totalTokens ?? 0).toLocaleString()}
                  </span>
                  <span className="metric-footer success">Input + output</span>
                </div>
                <div className="metric-card">
                  <div className="metric-header">
                    <span className="metric-label">Estimated Cost</span>
                    <div className="metric-icon-wrapper">
                      <ShieldCheck size={16} />
                    </div>
                  </div>
                  <span className="metric-value">
                    ${(llmQuery.data?.totalCostUsd ?? 0).toFixed(4)}
                  </span>
                  <span className="metric-footer success">USD, all providers</span>
                </div>
                <div className="metric-card">
                  <div className="metric-header">
                    <span className="metric-label">Models Used</span>
                    <div className="metric-icon-wrapper">
                      <Settings size={16} />
                    </div>
                  </div>
                  <span className="metric-value">{llmQuery.data?.byModel.length ?? 0}</span>
                  <span className="metric-footer success">Distinct provider/model pairs</span>
                </div>
              </div>

              <table className="compliance-table" style={{ marginTop: '24px' }}>
                <thead>
                  <tr>
                    <th>Provider</th>
                    <th>Model</th>
                    <th>Requests</th>
                    <th>Tokens</th>
                    <th>Est. Cost (USD)</th>
                  </tr>
                </thead>
                <tbody>
                  {(!llmQuery.data || llmQuery.data.byModel.length === 0) && (
                    <tr>
                      <td colSpan={5} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
                        No LLM usage recorded yet.
                      </td>
                    </tr>
                  )}
                  {(llmQuery.data?.byModel ?? []).map((m) => (
                    <tr key={`${m.provider}/${m.model}`}>
                      <td>{m.provider}</td>
                      <td>
                        <code>{m.model}</code>
                      </td>
                      <td>{m.requests}</td>
                      <td>{m.tokens.toLocaleString()}</td>
                      <td>${m.costUsd.toFixed(4)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="report-card" style={{ width: '100%' }}>
              <div className="report-card-title">
                <FileText size={20} style={{ color: 'var(--color-primary)' }} />
                Escalation Reasons (Handoffs)
              </div>
              {reasonsQuery.loading && !reasonsQuery.data && (
                <StatusNote kind="loading">Loading handoff statistics…</StatusNote>
              )}
              {reasonsQuery.error && <StatusNote kind="error">{reasonsQuery.error}</StatusNote>}
              <table className="compliance-table">
                <thead>
                  <tr>
                    <th>Escalation Reason</th>
                    <th>Count</th>
                  </tr>
                </thead>
                <tbody>
                  {reasonsQuery.data && reasonsQuery.data.length === 0 && (
                    <tr>
                      <td colSpan={2} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
                        No handoffs recorded yet — the AI has handled everything autonomously.
                      </td>
                    </tr>
                  )}
                  {(reasonsQuery.data ?? []).map((r) => (
                    <tr key={r.reason}>
                      <td>
                        <code>{r.reason}</code>
                      </td>
                      <td>{r.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ─── Tab View: Analytics ────────────────────────────────── */}
        {activeTab === 'analytics' && (
          <div className="report-workspace">
            <div className="report-card" style={{ width: '100%' }}>
              <div className="report-card-title">
                <BarChart3 size={20} style={{ color: 'var(--color-primary)' }} />
                14-Day Activity Trend
              </div>
              <p style={{ color: 'var(--text-muted)', fontSize: '13px', marginTop: '-12px', marginBottom: '20px' }}>
                Daily messages, new leads, and bookings for the last 14 days (bucketed by UTC date).
              </p>
              <ActivityTrendChart
                data={activityTrendQuery.data}
                loading={activityTrendQuery.loading}
                error={activityTrendQuery.error}
              />
            </div>

            <div className="report-card" style={{ width: '100%' }}>
              <div className="report-card-title">
                <UserCheck size={20} style={{ color: 'var(--color-primary)' }} />
                Lead Funnel by Stage
              </div>
              <p style={{ color: 'var(--text-muted)', fontSize: '13px', marginTop: '-12px', marginBottom: '20px' }}>
                Lead counts across the pipeline: new → contacted → qualified → proposal → won.
              </p>
              <LeadFunnelChart
                data={leadFunnelQuery.data}
                loading={leadFunnelQuery.loading}
                error={leadFunnelQuery.error}
              />
            </div>
          </div>
        )}

        {/* ─── Tab View: Knowledge Base ───────────────────────────── */}
        {activeTab === 'kb' && (
          <div className="report-workspace">
            <div className="report-card" style={{ width: '100%' }}>
              <div className="report-card-title">
                <BookOpen size={20} style={{ color: 'var(--color-primary)' }} />
                Ingested RAG Documents
              </div>
              {kbDocsQuery.loading && !kbDocsQuery.data && (
                <StatusNote kind="loading">Loading knowledge documents…</StatusNote>
              )}
              {kbDocsQuery.error && <StatusNote kind="error">{kbDocsQuery.error}</StatusNote>}
              <table className="compliance-table">
                <thead>
                  <tr>
                    <th>Document Title</th>
                    <th>Source Path</th>
                    <th>Status</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {kbDocsQuery.data && kbDocsQuery.data.length === 0 && (
                    <tr>
                      <td colSpan={4} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
                        No documents ingested yet. Run the gateway ingestion pipeline to seed the
                        knowledge base.
                      </td>
                    </tr>
                  )}
                  {(kbDocsQuery.data ?? []).map((doc) => (
                    <tr key={doc.id}>
                      <td>
                        <code>{doc.title}</code>
                      </td>
                      <td style={{ color: 'var(--text-muted)' }}>{doc.source_path ?? '—'}</td>
                      <td>
                        <span className="status-badge pass">{doc.status ?? 'unknown'}</span>
                      </td>
                      <td>
                        <button
                          className="btn btn-secondary"
                          style={{ padding: '6px 12px', fontSize: '12px' }}
                          disabled={!doc.source_path}
                          onClick={() => {
                            if (doc.source_path) {
                              void navigator.clipboard.writeText(doc.source_path);
                            }
                          }}
                        >
                          <Copy size={12} /> Copy Path
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
