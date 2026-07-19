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
 */
export function checkNoMedicalClaims(response: string): boolean {
  const medicalTerms = ['diagnose', 'cure', 'treat disease', 'medical condition', 'prescription'];
  const lower = response.toLowerCase();
  return !medicalTerms.some((term) => lower.includes(term));
}

/**
 * Check if the response attempts to expose internal system data.
 */
export function checkNoInternalLeakage(response: string): boolean {
  const leakagePatterns = ['system prompt', 'internal api', 'database', 'sql query', 'api key', 'secret'];
  const lower = response.toLowerCase();
  return !leakagePatterns.some((p) => lower.includes(p));
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

  // Sales enquiry
  if (['buy', 'purchase', 'price', 'cost', 'interested in', 'i need', 'looking for', 'recommend', 'suggest', 'which product', 'best for', 'how much is'].some((k) => lower.includes(k))) return 'sales_enquiry';

  // Order status
  if (['order status', 'where is my order', 'tracking', 'package', 'delivery status', 'when will i receive', 'owner of order', 'order'].some((k) => lower.includes(k))) return 'order_status';

  // Product question
  if (['what is', 'how to use', 'ingredients', 'spf', 'difference between', 'suitable for', 'good for', 'tested', 'niacinamide', 'vitamin c', 'serum', 'cleanser'].some((k) => lower.includes(k))) return 'product_question';

  return 'unknown';
}
