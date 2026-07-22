import type { LLMGateway } from '@business-os-ai/llm-gateway';

/**
 * TypeScript port of the CrewAI trip planner (trip_agents.py). The four CrewAI
 * "agents" become staged prompts on our own LLM gateway (free Groq/Google), run
 * for a KNOWN destination (the quoted package), so it attaches a real day-by-day
 * itinerary + budget to a travel quote. City-selection is skipped because the
 * destination is already chosen by the quote.
 */
export interface ItineraryInputs {
  destination: string;
  durationDays: number;
  travellers?: number;
  budgetText?: string;   // e.g. "₹99,998 total"
  interests?: string;    // optional
  season?: string;       // optional
}

export interface ItineraryPlan {
  destinationInsights: string;
  dayByDay: string;
  budgetBreakdown: string;
}

async function runAgent(
  llm: LLMGateway,
  organizationId: string,
  system: string,
  task: string,
  maxTokens: number,
): Promise<string> {
  const completion = await llm.generateCompletion({
    organizationId,
    maxTokens,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: task },
    ],
  });
  return completion.content.trim();
}

/**
 * Runs the Local Expert → Travel Planner → Budget Specialist chain for a fixed
 * destination and returns the three sections. Sequential: the budget agent is
 * grounded in the itinerary the planner produced (mirrors the CrewAI `context`).
 */
export async function planItinerary(
  llm: LLMGateway,
  organizationId: string,
  input: ItineraryInputs,
): Promise<ItineraryPlan> {
  const dest = input.destination;
  const days = Math.max(1, Math.min(21, input.durationDays || 3));
  const who = input.travellers ? ` for ${input.travellers} traveller(s)` : '';

  // 1) Local Destination Expert
  const destinationInsights = await runAgent(
    llm, organizationId,
    'You are a Local Destination Expert — a knowledgeable local guide with first-hand experience of the destination\'s culture and attractions. Be accurate, concise, and practical. Do not invent specific prices.',
    `Give a traveller a quick, well-organised briefing on ${dest} with these headings and short bullet points:\n- Top 5 attractions\n- Local cuisine highlights\n- Cultural norms / etiquette\n- Recommended areas to stay\n- Getting around (transport tips)`,
    650,
  );

  // 2) Professional Travel Planner
  const dayByDay = await runAgent(
    llm, organizationId,
    'You are a Professional Travel Planner — an experienced coordinator with excellent logistics. Create realistic, well-paced day plans; avoid over-packing days.',
    `Create a ${days}-day itinerary for ${dest}${input.interests ? ` for someone interested in ${input.interests}` : ''}${input.season ? `, travelling in ${input.season}` : ''}.\n` +
    `For each day use a heading "Day N" and cover Morning / Afternoon / Evening with activity sequencing, transport between spots, and a meal suggestion. Keep each day tight and readable.`,
    950,
  );

  // 3) Travel Budget Specialist (grounded in the itinerary above)
  const budgetBreakdown = await runAgent(
    llm, organizationId,
    'You are a Travel Budget Specialist — a financial planner specialising in travel budgets and cost optimisation. Give indicative ranges, not false precision.',
    `Produce an itemised, indicative budget for this ${days}-day trip to ${dest}${who}${input.budgetText ? `, targeting roughly ${input.budgetText}` : ''}.\n` +
    `Cover: accommodation, transport, activities/entry fees, meals, and an emergency allowance, then a total range. Base it on this itinerary:\n\n${dayByDay.slice(0, 1600)}`,
    550,
  );

  return { destinationInsights, dayByDay, budgetBreakdown };
}
