/**
 * Pure marketing helpers — no DB, no network — so they're unit-testable.
 *
 * Covers: audience-filter normalization, stateless tracked-link tokens (HMAC,
 * no table needed), email link wrapping, {{placeholder}} personalization, and
 * the campaign analytics math (open rate / CTR / conversion / engagement).
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

// ── Audience segmentation ──────────────────────────────────────────
export interface SegmentFilter {
  /** Lead stages to include (e.g. ['qualified','contacted']). Empty = any. */
  stages?: string[];
  /** Minimum lead score. */
  minScore?: number;
  /** Substring match on service_interest (case-insensitive). */
  serviceInterest?: string;
  /** Only contacts active within N days. */
  recencyDays?: number;
  /** Only contacts that have an email (required for the email channel). */
  requireEmail?: boolean;
}

export function normalizeFilter(raw: unknown): SegmentFilter {
  const r = (raw ?? {}) as Record<string, unknown>;
  const out: SegmentFilter = {};
  if (Array.isArray(r.stages)) out.stages = r.stages.map(String).filter(Boolean);
  if (typeof r.minScore === 'number' && r.minScore > 0) out.minScore = r.minScore;
  if (typeof r.serviceInterest === 'string' && r.serviceInterest.trim()) out.serviceInterest = r.serviceInterest.trim();
  if (typeof r.recencyDays === 'number' && r.recencyDays > 0) out.recencyDays = Math.floor(r.recencyDays);
  if (r.requireEmail === true) out.requireEmail = true;
  return out;
}

// ── Tracked-link tokens (stateless, HMAC-signed) ───────────────────
export interface TrackPayload {
  /** campaign id */ c: string;
  /** recipient id */ r: string;
  /** target url */ u: string;
}

const b64url = (s: string): string => Buffer.from(s).toString('base64url');

function hmac(secret: string, data: string): string {
  return createHmac('sha256', secret).update(data).digest('base64url');
}

/** `<base64url payload>.<base64url hmac>` — compact and self-verifying. */
export function signTrack(secret: string, p: TrackPayload): string {
  const body = b64url(JSON.stringify(p));
  return `${body}.${hmac(secret, body)}`;
}

export function verifyTrack(secret: string, token: string): TrackPayload | null {
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = hmac(secret, body);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as TrackPayload;
    if (!parsed.c || !parsed.r || !parsed.u) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function trackedUrl(baseUrl: string, secret: string, p: TrackPayload): string {
  return `${baseUrl.replace(/\/$/, '')}/r/${signTrack(secret, p)}`;
}

/** Rewrite every http(s) link in email HTML to route through /r/ for CTR. */
export function wrapEmailLinks(
  html: string,
  baseUrl: string,
  secret: string,
  campaignId: string,
  recipientId: string,
): string {
  return html.replace(/href="(https?:\/\/[^"]+)"/gi, (_m, url: string) =>
    `href="${trackedUrl(baseUrl, secret, { c: campaignId, r: recipientId, u: url })}"`,
  );
}

/** Replace {{name}}, {{url}}, … placeholders. Unknown placeholders are left blank. */
export function personalize(text: string, vars: Record<string, string>): string {
  return text.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_m, key: string) => vars[key] ?? '');
}

// ── Analytics math ─────────────────────────────────────────────────
export interface RecipientLike {
  status: string;
  delivered_at?: string | null;
  opened_at?: string | null;
  clicked_at?: string | null;
  converted_at?: string | null;
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

const pct = (n: number, d: number): number => (d > 0 ? Math.round((n / d) * 1000) / 10 : 0);

export function computeStats(recipients: RecipientLike[]): CampaignStats {
  const total = recipients.length;
  // "sent" = reached the provider without error (everything not failed/queued).
  const sent = recipients.filter((r) => r.status !== 'failed' && r.status !== 'queued').length;
  const delivered = recipients.filter((r) => r.delivered_at || r.opened_at).length;
  const opened = recipients.filter((r) => r.opened_at).length;
  const clicked = recipients.filter((r) => r.clicked_at).length;
  const converted = recipients.filter((r) => r.converted_at).length;
  const base = sent || total;
  return {
    total,
    sent,
    delivered,
    opened,
    clicked,
    converted,
    deliveryRate: pct(delivered, base),
    openRate: pct(opened, base),
    ctr: pct(clicked, base),
    conversionRate: pct(converted, base),
  };
}

/**
 * Per-contact engagement score (0–100): weighted recent activity. Rewards
 * opens/clicks/conversions and inbound replies, decays with inactivity.
 */
export function engagementScore(input: {
  opens: number;
  clicks: number;
  conversions: number;
  inboundMessages: number;
  daysSinceLastActivity: number | null;
}): number {
  const activity =
    input.opens * 8 + input.clicks * 18 + input.conversions * 40 + input.inboundMessages * 6;
  const recency =
    input.daysSinceLastActivity == null
      ? 0
      : Math.max(0, 20 - input.daysSinceLastActivity); // full 20 pts if active today
  return Math.max(0, Math.min(100, Math.round(activity + recency)));
}
