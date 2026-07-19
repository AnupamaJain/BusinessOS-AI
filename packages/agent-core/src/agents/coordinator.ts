import { VerticalRegistry } from '@business-os-ai/verticals';
import { LLMGateway } from '@business-os-ai/llm-gateway';
import type { AgentState } from '../state';
import { logger } from '@business-os-ai/shared-types';

export class CoordinatorAgent {
  private llmGateway: LLMGateway;

  constructor(llmGateway?: LLMGateway) {
    this.llmGateway = llmGateway ?? new LLMGateway();
  }

  public async coordinate(
    state: AgentState,
    verticalId: string = 'travel'
  ): Promise<{ nextAgentId: string; responseText: string; proposedTools: string[] }> {
    const vertical = VerticalRegistry.get(verticalId) ?? VerticalRegistry.get('travel')!;

    // Select specialized agent based on intent
    let selectedAgent = vertical.agents.find(a => a.role === 'sales') ?? vertical.agents[0]!;

    if (state.intent === 'support_question' || state.intent === 'complaint_or_refund' || state.intent === 'order_status') {
      selectedAgent = vertical.agents.find(a => a.role === 'support') ?? selectedAgent;
    }

    logger.info(`Coordinator delegated message to specialized agent '${selectedAgent.id}' [Vertical: ${vertical.name}]`, {
      intent: state.intent,
      agentId: selectedAgent.id,
      organizationId: state.organizationId
    });

    const completion = await this.llmGateway.generateCompletion({
      organizationId: state.organizationId,
      messages: [
        { role: 'system', content: selectedAgent.systemPrompt },
        { role: 'user', content: state.inboundMessage }
      ],
      preferredProvider: 'mock'
    });

    return {
      nextAgentId: selectedAgent.id,
      responseText: completion.content,
      proposedTools: selectedAgent.allowedTools
    };
  }
}
