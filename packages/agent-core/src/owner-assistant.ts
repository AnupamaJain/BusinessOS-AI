import type { LLMGateway } from '@business-os-ai/llm-gateway';
import type { BusinessSummary } from '@business-os-ai/mcp-business-tools';
import { logger } from '@business-os-ai/shared-types';

/**
 * Owner-facing assistant: the business owner messages Saarthi to run their
 * business ("how many hot leads today?"). Answers are grounded strictly in the
 * live BusinessSummary — never invented — and always offer one useful next step.
 */
export async function runOwnerAssistant(params: {
  llm?: LLMGateway;
  organizationId: string;
  businessName: string;
  message: string;
  summary: BusinessSummary;
}): Promise<string> {
  const { llm, organizationId, businessName, message, summary } = params;

  const facts = [
    `New enquiries today: ${summary.todayEnquiries}`,
    `Hot leads (score ≥ 70, still open): ${summary.hotLeads}`,
    `Qualified leads: ${summary.qualifiedLeads}`,
    `Waiting for payment: ${summary.pendingPayments}`,
    `Going cold (no activity 3+ days): ${summary.staleLeads}`,
    `Revenue pipeline: ${summary.pipelineText}`,
  ];
  if (summary.topHotLeads.length > 0) {
    facts.push('Top hot leads: ' + summary.topHotLeads.map((l) => `${l.name ?? 'Lead'} — ${l.serviceInterest}${l.score ? ` (score ${l.score})` : ''}`).join('; '));
  }

  // LLM-composed briefing when a real provider is configured.
  if (llm && llm.hasRealProvider) {
    try {
      const completion = await llm.generateCompletion({
        organizationId,
        maxTokens: 320,
        temperature: 0.3,
        messages: [
          {
            role: 'system',
            content: `You are Saarthi, the AI business co-pilot for ${businessName}. The person messaging you is the BUSINESS OWNER, not a customer.
Answer their question using ONLY the live numbers in DATA — never invent figures. Be concise and WhatsApp-friendly (short lines, a few emojis, bullet points with •). Lead with the number they asked for. End with ONE proactive suggestion (e.g. offer to follow up with cold or unpaid leads).`,
          },
          { role: 'user', content: `DATA (live):\n${facts.join('\n')}\n\nOwner asks: ${message}` },
        ],
      });
      const text = completion.content.trim();
      if (text) return text;
    } catch (err) {
      logger.warn('Owner assistant LLM failed; using deterministic briefing', { error: err instanceof Error ? err.message : String(err) });
    }
  }

  // Deterministic fallback briefing.
  const lines = [
    `📊 *${businessName} — today*`,
    `• ${summary.todayEnquiries} new enquiries`,
    `• ${summary.hotLeads} hot leads`,
    `• ${summary.qualifiedLeads} qualified`,
    `• ${summary.pendingPayments} waiting for payment`,
    `• ${summary.staleLeads} going cold (no reply in 3+ days)`,
    `• Pipeline: ${summary.pipelineText}`,
  ];
  if (summary.staleLeads > 0) {
    lines.push('', `Want me to follow up with the ${summary.staleLeads} cold lead(s)? Reply *yes*.`);
  }
  return lines.join('\n');
}

/** True when the owner is asking us to act on the previous suggestion. */
export function isOwnerConfirmation(message: string): boolean {
  return /^\s*(yes|yep|yeah|do it|go ahead|follow up|please do|sure)\b/i.test(message);
}
