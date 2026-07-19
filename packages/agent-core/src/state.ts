import { z } from 'zod';
import { IntentType } from '@whatsapp-smb/shared-types';

/**
 * LangGraph agent state.
 * Tracks the full lifecycle of processing an inbound message.
 */
export const AgentStateSchema = z.object({
  organizationId: z.string().uuid(),
  contactId: z.string().uuid(),
  conversationId: z.string().uuid(),
  inboundMessage: z.string(),
  recentMessages: z.array(z.object({
    direction: z.enum(['inbound', 'outbound']),
    content: z.string(),
    createdAt: z.string(),
  })).default([]),
  customerContext: z.record(z.unknown()).optional(),
  intent: IntentType.default('unknown'),
  extractedFields: z.record(z.unknown()).default({}),
  retrievedSources: z.array(z.object({
    documentId: z.string(),
    chunkId: z.string(),
    content: z.string(),
    score: z.number(),
  })).default([]),
  toolCalls: z.array(z.object({
    tool: z.string(),
    input: z.record(z.unknown()),
    output: z.record(z.unknown()).optional(),
  })).default([]),
  policyDecision: z.object({
    allowed: z.boolean(),
    reason: z.string(),
    shouldHandoff: z.boolean(),
  }).optional(),
  proposedResponse: z.string().optional(),
  finalResponse: z.string().optional(),
  handoffId: z.string().optional(),
  errors: z.array(z.string()).default([]),
  traceId: z.string(),
});

export type AgentState = z.infer<typeof AgentStateSchema>;

/**
 * Create an initial agent state for processing an inbound message.
 */
export function createInitialState(params: {
  organizationId: string;
  contactId: string;
  conversationId: string;
  inboundMessage: string;
  traceId: string;
}): AgentState {
  return {
    organizationId: params.organizationId,
    contactId: params.contactId,
    conversationId: params.conversationId,
    inboundMessage: params.inboundMessage,
    recentMessages: [],
    intent: 'unknown',
    extractedFields: {},
    retrievedSources: [],
    toolCalls: [],
    errors: [],
    traceId: params.traceId,
  };
}
