import { describe, it, expect, vi } from 'vitest';
import { planItinerary } from '../itinerary-planner';
import type { LLMGateway } from '@business-os-ai/llm-gateway';

function mockLlm() {
  const calls: Array<{ system: string; user: string }> = [];
  const gen = vi.fn(async (req: { messages: Array<{ role: string; content: string }> }) => {
    const system = req.messages.find((m) => m.role === 'system')?.content ?? '';
    const user = req.messages.find((m) => m.role === 'user')?.content ?? '';
    calls.push({ system, user });
    const label = system.includes('Local Destination') ? 'INSIGHTS'
      : system.includes('Travel Planner') ? 'Day 1: ITINERARY'
      : 'BUDGET total ₹X';
    return { content: label, provider: 'mock', model: 'mock', usage: { promptTokens: 1, completionTokens: 1 } };
  });
  const llm = { generateCompletion: gen } as unknown as LLMGateway;
  return { llm, calls, gen };
}

describe('planItinerary (CrewAI port)', () => {
  it('runs the three staged agents and returns all sections', async () => {
    const { llm, calls, gen } = mockLlm();
    const plan = await planItinerary(llm, 'org-1', { destination: 'Bali', durationDays: 5, travellers: 2, budgetText: '₹99,998 total' });

    expect(gen).toHaveBeenCalledTimes(3);
    expect(plan.destinationInsights).toBe('INSIGHTS');
    expect(plan.dayByDay).toBe('Day 1: ITINERARY');
    expect(plan.budgetBreakdown).toBe('BUDGET total ₹X');
    // Prompts carry the destination + duration.
    expect(calls[1]!.user).toContain('5-day itinerary for Bali');
    // Budget agent is grounded in the itinerary the planner produced.
    expect(calls[2]!.user).toContain('Day 1: ITINERARY');
    expect(calls[2]!.user).toContain('₹99,998 total');
  });

  it('clamps an absurd duration and still returns sections', async () => {
    const { llm } = mockLlm();
    const plan = await planItinerary(llm, 'org-1', { destination: 'Goa', durationDays: 999 });
    expect(plan.dayByDay).toBeTruthy();
  });
});
