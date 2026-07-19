export type LLMProviderName = 'openai' | 'anthropic' | 'google' | 'groq' | 'openrouter' | 'llama' | 'gateway' | 'mock';

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string;
}

export interface LLMCompletionRequest {
  organizationId: string;
  messages: LLMMessage[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
  tools?: Array<{
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  }>;
  preferredProvider?: LLMProviderName;
}

export interface LLMCompletionResponse {
  provider: LLMProviderName;
  model: string;
  content: string;
  toolCalls?: Array<{
    id: string;
    name: string;
    arguments: Record<string, unknown>;
  }>;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    estimatedCostUsd: number;
  };
  latencyMs: number;
}

export interface LLMProvider {
  name: LLMProviderName;
  generateCompletion(request: LLMCompletionRequest): Promise<LLMCompletionResponse>;
}
