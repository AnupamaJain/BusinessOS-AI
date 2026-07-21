import type { IntentType } from '@business-os-ai/shared-types';
import type { AgentState } from './state';

/**
 * Deterministic policy engine.
 * All rules are pure TypeScript functions — never prompt-based.
 */

/** Intents that must always trigger human handoff. */
const HANDOFF_INTENTS: IntentType[] = [
  'complaint_or_refund',
  'human_request',
  'unsafe_request',
];

/** Intents that indicate opt-out. */
const OPT_OUT_INTENTS: IntentType[] = ['opt_out'];

/** Keywords that suggest medical/legal/payment issues requiring handoff. */
const SENSITIVE_KEYWORDS = [
  'diagnosis', 'diagnose', 'treatment', 'prescription', 'medical advice', 'cure', 'eczema', 'disease',
  'lawyer', 'legal action', 'court', 'sue',
  'payment failed', 'refund', 'chargeback',
  'account hack', 'security breach', 'password',
  'phone number', 'email address', 'address of',
];

export interface PolicyDecision {
  allowed: boolean;
  reason: string;
  shouldHandoff: boolean;
}

/**
 * Check if the message/intent requires mandatory handoff.
 */
export function checkHandoffRequired(intent: IntentType, message: string): boolean {
  if (HANDOFF_INTENTS.includes(intent)) return true;
  const lower = message.toLowerCase();
  return SENSITIVE_KEYWORDS.some((kw) => lower.includes(kw));
}

/**
 * Check if the intent is an opt-out request.
 */
export function checkOptOut(intent: IntentType, message: string): boolean {
  if (OPT_OUT_INTENTS.includes(intent)) return true;
  const lower = message.toLowerCase();
  return ['stop', 'unsubscribe', 'opt out', 'opt-out', 'do not contact'].some((kw) => lower.includes(kw));
}

export function checkGrounding(sources: AgentState['retrievedSources'], threshold = 0.01): boolean {
  if (sources.length === 0) return false;
  return sources.some((s) => s.score >= threshold);
}

/**
 * Check if the proposed response contains medical claims.
 * Uses word-boundary matching so ordinary words that merely contain a term as a
 * substring (e.g. "se**cure**", "man**cure**") are not falsely flagged.
 */
export function checkNoMedicalClaims(response: string): boolean {
  const medicalTerms = [/\bdiagnos(e|is|ing)\b/, /\bcure[sd]?\b/, /\btreat\s+disease\b/, /\bmedical condition\b/, /\bprescription\b/];
  const lower = response.toLowerCase();
  return !medicalTerms.some((re) => re.test(lower));
}

/**
 * Check if the response attempts to expose internal system data.
 * Word-boundary matching avoids false positives like "data**base**"-free words.
 */
export function checkNoInternalLeakage(response: string): boolean {
  const leakagePatterns = [/\bsystem prompt\b/, /\binternal api\b/, /\bdatabase\b/, /\bsql query\b/, /\bapi key\b/, /\bsecret\b/];
  const lower = response.toLowerCase();
  return !leakagePatterns.some((re) => re.test(lower));
}

/**
 * Full policy gate — evaluates all rules and returns a decision.
 */
export function evaluatePolicy(state: AgentState): PolicyDecision {
  // 1. Opt-out — always honor
  if (checkOptOut(state.intent, state.inboundMessage)) {
    return { allowed: true, reason: 'opt_out_flow', shouldHandoff: false };
  }

  // 2. Handoff required
  if (checkHandoffRequired(state.intent, state.inboundMessage)) {
    return { allowed: false, reason: 'handoff_required', shouldHandoff: true };
  }

  // 3. Unsafe request
  if (state.intent === 'unsafe_request') {
    return { allowed: false, reason: 'unsafe_request_blocked', shouldHandoff: true };
  }

  // 4. Check proposed response if available
  if (state.proposedResponse) {
    if (!checkNoMedicalClaims(state.proposedResponse)) {
      return { allowed: false, reason: 'medical_claims_detected', shouldHandoff: true };
    }
    if (!checkNoInternalLeakage(state.proposedResponse)) {
      return { allowed: false, reason: 'internal_data_leakage_risk', shouldHandoff: true };
    }
  }

  // 5. Grounding check for support/product questions
  if (['product_question', 'support_question'].includes(state.intent)) {
    if (!checkGrounding(state.retrievedSources)) {
      return { allowed: false, reason: 'insufficient_grounding', shouldHandoff: true };
    }
  }

  return { allowed: true, reason: 'policy_passed', shouldHandoff: false };
}

// ─── Layer 9: human-approval escalation helpers ─────────────────────────
// These detect messages that must be escalated to a human before the agent
// answers, based on per-merchant business rules. All pure/deterministic.

/**
 * Detect a discount request that exceeds the merchant's max-discount cap.
 * Conservative: requires an explicit number that is greater than the cap —
 * either a percentage ("30% off", "20 percent discount") or a bare number in
 * an unmistakable discount context ("give me 30 off", "cheaper by 25").
 * Returns false when there is no cap configured.
 */
export function requestsDiscountBeyondCap(message: string, maxDiscountPercent?: number): boolean {
  if (maxDiscountPercent == null) return false;
  const lower = message.toLowerCase();

  // 1. Explicit percentages: "15%", "20 percent", "10 pct".
  for (const m of lower.matchAll(/(\d+(?:\.\d+)?)\s*(?:%|percent|pct)/g)) {
    if (Number(m[1]) > maxDiscountPercent) return true;
  }

  // 2. Bare number in a clear discount context ("30 off", "cheaper by 25").
  const discountContext = /\b(discount|off|cheaper|best price|lower price|reduce|less price|deal|bargain)\b/.test(lower);
  if (discountContext) {
    for (const m of lower.matchAll(/(\d+(?:\.\d+)?)/g)) {
      const n = Number(m[1]);
      // Treat only plausible percentage magnitudes (≤100) as discounts, so
      // prices ("best price for 5000") don't trip the guard.
      if (n > maxDiscountPercent && n <= 100) return true;
    }
  }
  return false;
}

/**
 * Detect a refund (or cancellation-with-refund) request.
 */
export function requestsRefund(message: string): boolean {
  const lower = message.toLowerCase();
  if (/\b(refund|money back|reimburse|charge\s?back)\b/.test(lower)) return true;
  if (/\bcancel/.test(lower) && /\b(refund|money|amount|payment|charge)\b/.test(lower)) return true;
  return false;
}

// ─── Layer 1: role gating helpers ───────────────────────────────────────

/** AI-team roles a merchant can enable/disable. */
export type AgentRole = 'sales' | 'support' | 'booking' | 'operations';

/**
 * Map a classified intent to the AI-team role that should handle it.
 * Returns null for intents that must never be gated (safety, handoff, greeting).
 */
export function requiredRoleForIntent(intent: IntentType): AgentRole | null {
  switch (intent) {
    case 'sales_enquiry':
      return 'sales';
    case 'booking_request':
      return 'booking';
    case 'support_question':
    case 'product_question':
    case 'order_status':
    case 'complaint_or_refund':
      return 'support';
    default:
      // unknown/greeting, opt_out, human_request, unsafe_request → never gated
      return null;
  }
}

/**
 * Whether the required role is enabled for this merchant.
 * When `enabledAgents` is undefined or empty, nothing is gated (backward compatible).
 * A null role (safety/handoff/greeting) is never gated.
 */
export function isRoleEnabled(role: AgentRole | null, enabledAgents?: string[]): boolean {
  if (!role) return true;
  if (!enabledAgents || enabledAgents.length === 0) return true;
  return enabledAgents.includes(role);
}

/**
 * Simple keyword-based intent classifier (deterministic for MVP).
 * In production, this would call an LLM.
 */
export function classifyIntent(message: string): IntentType {
  const lower = message.toLowerCase();

  // Opt-out
  if (checkOptOut('unknown', lower)) return 'opt_out';

  // Unsafe / prompt injection
  if (['hack', 'exploit', 'ignore previous', 'system prompt', 'select * from', 'system overrides', 'database schema'].some((k) => lower.includes(k))) return 'unsafe_request';

  // Medical / safety questions -> support_question
  if (['eczema', 'disease', 'diagnose', 'prescription', 'medicine', 'cure'].some((k) => lower.includes(k))) return 'support_question';

  // Complaint/refund
  if (['refund', 'complaint', 'not satisfied', 'damaged', 'broken', 'wrong product', 'money back', 'deducted', 'failed'].some((k) => lower.includes(k))) return 'complaint_or_refund';

  // Human request
  if (['person', 'human', 'agent', 'support team', 'speak to', 'talk to', 'operator'].some((k) => lower.includes(k))) return 'human_request';

  // Booking
  if (['book', 'appointment', 'schedule', 'reserve', 'slot', 'consultation'].some((k) => lower.includes(k))) return 'booking_request';

  // Support question (shipping/returns/hours)
  if (['shipping', 'delivery time', 'returns', 'exchange', 'policy', 'hours', 'contact', 'support', 'address', 'phone number'].some((k) => lower.includes(k))) return 'support_question';

  // Sales enquiry (incl. cab-intercity & home-services vertical phrasings)
  if ([
    'buy', 'purchase', 'price', 'cost', 'interested in', 'i need', 'looking for', 'recommend', 'suggest', 'which product', 'best for', 'how much is',
    // Cab (intercity)
    'cab', 'taxi', 'outstation', 'intercity',
    // Home services (maid/cook/cleaning)
    'maid', 'cook', 'cooking', 'cleaning', 'cleaner', 'housekeeping', 'househelp', 'babysitter', 'nanny', 'deep clean', 'full-time maid',
  ].some((k) => lower.includes(k))) return 'sales_enquiry';

  // Order status
  if (['order status', 'where is my order', 'tracking', 'package', 'delivery status', 'when will i receive', 'owner of order', 'order'].some((k) => lower.includes(k))) return 'order_status';

  // Product question
  if (['what is', 'how to use', 'ingredients', 'spf', 'difference between', 'suitable for', 'good for', 'tested', 'niacinamide', 'vitamin c', 'serum', 'cleanser'].some((k) => lower.includes(k))) return 'product_question';

  return 'unknown';
}
