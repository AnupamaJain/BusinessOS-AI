import type { AgentState } from './state';
import { createInitialState } from './state';
import { classifyIntent, evaluatePolicy } from './policy';
import { ToolDataStore, getCustomerContext, upsertQualifiedLead, createHumanHandoff, searchProductCatalog, getOrderStatus } from '@business-os-ai/mcp-business-tools';
import { logger } from '@business-os-ai/shared-types';
import { retrieveRelevantChunks } from './rag';

/**
 * LangGraph-style workflow executor.
 * Implements the explicit routing graph:
 * START → load_context → classify_intent → policy_gate → flow → quality_gate → persist
 *
 * In production, this would use @langchain/langgraph.
 * For MVP, we implement the same deterministic graph as plain function calls.
 */
export async function executeAgentGraph(
  store: ToolDataStore,
  params: {
    organizationId: string;
    contactId: string;
    conversationId: string;
    inboundMessage: string;
    traceId: string;
  },
): Promise<AgentState> {
  let state = createInitialState(params);

  try {
    // ─── Node 1: load_customer_context ────────────────────────
    state = await nodeLoadContext(store, state);

    // ─── Node 2: classify_intent ──────────────────────────────
    state = nodeClassifyIntent(state);

    // ─── Retrieve RAG sources if support/product question BEFORE policy gate ─
    if (['product_question', 'support_question'].includes(state.intent)) {
      try {
        const sources = await retrieveRelevantChunks(state.organizationId, state.inboundMessage, 0.01);
        state.retrievedSources = sources;
      } catch (err) {
        state.errors.push('Failed to retrieve RAG sources');
      }
    }

    // ─── Node 3: policy_gate ──────────────────────────────────
    state = nodePolicyGate(state);

    // ─── Node 4: route to flow ────────────────────────────────
    if (state.policyDecision?.shouldHandoff) {
      state = await nodeHandoffFlow(store, state);
    } else if (state.intent === 'opt_out') {
      state = nodeOptOutFlow(state);
    } else if (state.intent === 'sales_enquiry') {
      state = await nodeSalesFlow(store, state);
    } else if (['product_question', 'support_question'].includes(state.intent)) {
      state = await nodeRagSupportFlow(state);
    } else if (state.intent === 'order_status') {
      state = nodeOrderStatusFlow(store, state);
    } else if (state.intent === 'booking_request') {
      state = nodeBookingFlow(state);
    } else if (state.intent === 'unsafe_request') {
      state = nodeUnsafeDecline(state);
    } else {
      state = nodeClarificationFlow(state);
    }

    // ─── Node 5: response_quality_gate ────────────────────────
    state = nodeResponseQualityGate(state);

    // ─── Node 6: persist_outcome ──────────────────────────────
    state = nodePersistOutcome(state);

  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    state.errors.push(errMsg);
    state.finalResponse = "I'm sorry, I encountered an issue processing your request. Let me connect you with a team member who can help.";
    logger.error('Agent graph error', { traceId: state.traceId, organizationId: state.organizationId }, err instanceof Error ? err : undefined);
  }

  return state;
}

// ─── Graph nodes ─────────────────────────────────────────────────────

async function nodeLoadContext(store: ToolDataStore, state: AgentState): Promise<AgentState> {
  try {
    const ctx = getCustomerContext(store, {
      organizationId: state.organizationId,
      contactId: state.contactId,
      conversationId: state.conversationId,
      requestedFields: ['profile', 'consent', 'lead', 'messages', 'handoff'],
    });
    state.customerContext = ctx as unknown as Record<string, unknown>;
    state.recentMessages = ctx.recentMessages;

    // If there's an open handoff, don't continue automated processing
    if (ctx.openHandoff) {
      state.policyDecision = { allowed: false, reason: 'open_handoff_exists', shouldHandoff: false };
      state.finalResponse = "Your conversation is being handled by our team. A team member will respond shortly.";
    }
  } catch {
    state.errors.push('Failed to load customer context');
  }
  return state;
}

function nodeClassifyIntent(state: AgentState): AgentState {
  state.intent = classifyIntent(state.inboundMessage);
  logger.info('Intent classified', { traceId: state.traceId, intent: state.intent });
  return state;
}

function nodePolicyGate(state: AgentState): AgentState {
  // Skip if already decided (e.g., open handoff)
  if (state.finalResponse) return state;
  state.policyDecision = evaluatePolicy(state);
  logger.info('Policy evaluated', { traceId: state.traceId, decision: state.policyDecision });
  return state;
}

async function nodeHandoffFlow(store: ToolDataStore, state: AgentState): Promise<AgentState> {
  const result = createHumanHandoff(store, {
    organizationId: state.organizationId,
    contactId: state.contactId,
    conversationId: state.conversationId,
    reason: state.intent === 'complaint_or_refund' ? 'complaint_or_refund' :
            state.intent === 'human_request' ? 'customer_request' :
            state.intent === 'unsafe_request' ? 'unsafe_request' : 'low_confidence',
    priority: state.intent === 'complaint_or_refund' ? 'high' : 'medium',
    summary: `Customer message: "${state.inboundMessage.substring(0, 200)}". Intent: ${state.intent}. Reason: ${state.policyDecision?.reason ?? 'policy_gate'}`,
    idempotencyKey: `handoff:${state.conversationId}:${state.traceId}`,
  });
  state.handoffId = result.handoffId;
  state.proposedResponse = "I understand your concern. I'm connecting you with a team member who can help you directly. They'll have the context of our conversation. Please hang tight!";
  state.toolCalls.push({ tool: 'create_human_handoff', input: { reason: state.intent }, output: result });
  return state;
}

function nodeOptOutFlow(state: AgentState): AgentState {
  state.proposedResponse = "I've noted your preference. You've been unsubscribed from marketing messages. If you ever want to hear from us again, just send us a message. Thank you!";
  return state;
}

async function nodeSalesFlow(store: ToolDataStore, state: AgentState): Promise<AgentState> {
  // Search product catalog
  const skinType = state.inboundMessage.toLowerCase().includes('oily') ? 'oily' : undefined;
  const searchResult = searchProductCatalog(store, {
    organizationId: state.organizationId,
    query: state.inboundMessage,
    skinType,
  });
  state.toolCalls.push({ tool: 'search_product_catalog', input: { query: state.inboundMessage }, output: searchResult });

  if (searchResult.products.length > 0) {
    const product = searchResult.products[0]!;
    state.proposedResponse = `Based on your needs, I'd recommend our ${product.name} (${product.price}). ${product.description}. It's ${product.suitableFor.toLowerCase()}.\n\nWould you like to know more, or shall I connect you with our skincare specialist?`;

    // Create qualified lead
    const leadResult = upsertQualifiedLead(store, {
      organizationId: state.organizationId,
      contactId: state.contactId,
      conversationId: state.conversationId,
      serviceInterest: state.inboundMessage.substring(0, 500),
      qualificationSummary: `Customer interested in ${product.name}. Detected skin type: ${skinType ?? 'unknown'}.`,
      score: 65,
      idempotencyKey: `lead:${state.conversationId}:${state.traceId}`,
    });
    state.toolCalls.push({ tool: 'upsert_qualified_lead', input: { serviceInterest: state.inboundMessage }, output: leadResult });
  } else {
    state.proposedResponse = "I'd love to help you find the right product! Could you tell me a bit more about your skin type and what you're looking for? Our team can also give personalized recommendations.";
  }
  return state;
}

async function nodeRagSupportFlow(state: AgentState): Promise<AgentState> {
  try {
    const sources = await retrieveRelevantChunks(state.organizationId, state.inboundMessage, 0.01);
    state.retrievedSources = sources;
  } catch (err) {
    state.errors.push('Failed to retrieve RAG sources');
  }

  if (state.retrievedSources.length > 0 && state.retrievedSources.some((s) => s.score >= 0.01)) {
    const bestSource = state.retrievedSources.sort((a, b) => b.score - a.score)[0]!;
    state.proposedResponse = `Based on our information: ${bestSource.content}\n\nIs there anything else I can help with?`;
  } else {
    state.proposedResponse = "I want to make sure I give you accurate information. Let me connect you with our team for a detailed answer.";
    state.policyDecision = { allowed: false, reason: 'insufficient_grounding', shouldHandoff: true };
  }
  return state;
}

function nodeOrderStatusFlow(store: ToolDataStore, state: AgentState): AgentState {
  const match = state.inboundMessage.match(/GR-\d+/i);
  if (match && match[0]) {
    const orderNumber = match[0].toUpperCase();
    try {
      const result = getOrderStatus(store, {
        organizationId: state.organizationId,
        contactId: state.contactId,
        orderNumber,
      });

      if (result.found && result.order) {
        state.proposedResponse = `Your order ${orderNumber} status is: **${result.order.status}**.\nItems: ${result.order.items}\nTotal: ${result.order.totalAmount}\nEstimated Delivery: ${result.order.estimatedDelivery}`;
        state.toolCalls.push({
          tool: 'get_order_status',
          input: { orderNumber },
          output: result,
        });
      } else {
        state.proposedResponse = `I see you are asking about order ${orderNumber}, but I couldn't find an order with that number registered to your profile. Let me connect you with our team for assistance.`;
        state.policyDecision = { allowed: false, reason: 'handoff_required', shouldHandoff: true };
      }
    } catch (err) {
      state.errors.push(err instanceof Error ? err.message : String(err));
      state.proposedResponse = "I'm having trouble retrieving your order details. Let me transfer you to a representative.";
      state.policyDecision = { allowed: false, reason: 'handoff_required', shouldHandoff: true };
    }
  } else {
    state.proposedResponse = "I'd be happy to check your order status. For security, could you please provide your order number (e.g. GR-12345)?";
  }
  return state;
}

function nodeBookingFlow(state: AgentState): AgentState {
  state.proposedResponse = "I'd love to help you book an appointment! Could you let me know your preferred date and time? I'll check availability for you.";
  return state;
}

function nodeUnsafeDecline(state: AgentState): AgentState {
  state.proposedResponse = "I'm here to help with GlowRoot Skincare products and services. How can I assist you today?";
  return state;
}

function nodeClarificationFlow(state: AgentState): AgentState {
  state.proposedResponse = "Thanks for reaching out! Could you tell me a bit more about what you're looking for? I can help with product recommendations, order support, or connect you with our team.";
  return state;
}

function nodeResponseQualityGate(state: AgentState): AgentState {
  // If handoff was triggered during flow, use handoff response
  if (state.policyDecision?.shouldHandoff && !state.handoffId) {
    state.finalResponse = "I'm connecting you with our team for the best assistance. They'll be with you shortly!";
    return state;
  }
  state.finalResponse = state.proposedResponse ?? state.finalResponse ?? "Thank you for your message. How can I help you today?";
  return state;
}

function nodePersistOutcome(state: AgentState): AgentState {
  logger.info('Agent graph completed', {
    traceId: state.traceId,
    organizationId: state.organizationId,
    intent: state.intent,
    hasHandoff: !!state.handoffId,
    toolCallCount: state.toolCalls.length,
    errorCount: state.errors.length,
  });
  return state;
}
