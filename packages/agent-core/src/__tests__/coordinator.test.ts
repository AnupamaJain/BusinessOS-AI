import { describe, it, expect } from 'vitest';
import { CoordinatorAgent, createInitialState } from '../index';

const ORG_A = '11111111-1111-1111-1111-111111111111';
const CONTACT_A = '22222222-2222-2222-2222-222222222222';
const CONV_A = '33333333-3333-3333-3333-333333333333';

describe('CoordinatorAgent', () => {
  it('delegates travel package inquiries to travel-planner sales specialist agent', async () => {
    const state = createInitialState({ organizationId: ORG_A, contactId: CONTACT_A, conversationId: CONV_A, inboundMessage: 'Hi, I want a 5-day honeymoon package for Bali.', traceId: 'trace-1' });
    state.intent = 'sales_enquiry';

    const coordinator = new CoordinatorAgent();
    const result = await coordinator.coordinate(state, 'travel');

    expect(result.nextAgentId).toBe('travel-planner');
    expect(result.responseText).toBeDefined();
    expect(result.proposedTools).toContain('search_product_catalog');
  });

  it('delegates support & cancellation questions to travel care support agent', async () => {
    const state = createInitialState({ organizationId: ORG_A, contactId: CONTACT_A, conversationId: CONV_A, inboundMessage: 'What is the visa policy and cancellation refund for Europe tour?', traceId: 'trace-2' });
    state.intent = 'support_question';

    const coordinator = new CoordinatorAgent();
    const result = await coordinator.coordinate(state, 'travel');

    expect(result.nextAgentId).toBe('travel-support');
    expect(result.proposedTools).toContain('create_human_handoff');
  });
});
