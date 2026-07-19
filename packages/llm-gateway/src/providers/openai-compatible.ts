import type { LLMProvider, LLMProviderName, LLMCompletionRequest, LLMCompletionResponse } from '../types';

/** USD per 1M tokens: [input, output] — keyed by model substring. */
const PRICING: Array<[string, number, number]> = [
  ['claude-opus', 15, 75],
  ['claude-sonnet', 3, 15],
  ['claude-haiku', 1, 5],
  ['gpt-4o-mini', 0.15, 0.6],
  ['gpt-4o', 2.5, 10],
  ['gpt-4.1-mini', 0.4, 1.6],
  ['gpt-4.1', 2, 8],
  ['gemini-2.5-flash', 0.3, 2.5],
  ['gemini-2.5-pro', 1.25, 10],
];

function estimateCost(model: string, promptTokens: number, completionTokens: number): number {
  const match = PRICING.find(([key]) => model.includes(key));
  const [, inRate, outRate] = match ?? ['', 2, 8];
  return (promptTokens * inRate + completionTokens * outRate) / 1_000_000;
}

/**
 * Provider for any OpenAI-compatible chat-completions endpoint.
 *
 * Used for:
 *  - Vercel AI Gateway (https://ai-gateway.vercel.sh/v1) — authenticated with
 *    an AI Gateway API key or a Vercel OIDC token (automatic on Vercel deployments)
 *  - OpenAI directly (https://api.openai.com/v1)
 */
export class OpenAICompatibleProvider implements LLMProvider {
  public readonly name: LLMProviderName;

  constructor(private readonly config: {
    name: LLMProviderName;
    baseUrl: string;
    /** Called per request so short-lived tokens (OIDC) stay fresh. */
    getToken: () => string | undefined;
    defaultModel: string;
  }) {
    this.name = config.name;
  }

  async generateCompletion(request: LLMCompletionRequest): Promise<LLMCompletionResponse> {
    const started = Date.now();
    const token = this.config.getToken();
    if (!token) {
      throw new Error(`No credential available for LLM provider '${this.name}'.`);
    }
    const model = request.model ?? this.config.defaultModel;

    const body: Record<string, unknown> = {
      model,
      temperature: request.temperature ?? 0.3,
      max_tokens: request.maxTokens ?? 1024,
      messages: request.messages.map((m) => ({ role: m.role, content: m.content })),
    };
    if (request.tools && request.tools.length > 0) {
      body['tools'] = request.tools.map((t) => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.parameters },
      }));
    }

    const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`${this.name} LLM API error ${response.status}: ${errText.slice(0, 500)}`);
    }

    const data = (await response.json()) as {
      choices: Array<{
        message: {
          content: string | null;
          tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>;
        };
      }>;
      usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
      model?: string;
    };

    const choice = data.choices[0];
    const content = choice?.message?.content ?? '';
    const toolCalls = (choice?.message?.tool_calls ?? []).map((tc) => {
      let args: Record<string, unknown> = {};
      try { args = JSON.parse(tc.function.arguments); } catch { /* leave empty */ }
      return { id: tc.id, name: tc.function.name, arguments: args };
    });

    const promptTokens = data.usage?.prompt_tokens ?? 0;
    const completionTokens = data.usage?.completion_tokens ?? 0;

    return {
      provider: this.name,
      model: data.model ?? model,
      content,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      usage: {
        promptTokens,
        completionTokens,
        totalTokens: data.usage?.total_tokens ?? promptTokens + completionTokens,
        estimatedCostUsd: estimateCost(model, promptTokens, completionTokens),
      },
      latencyMs: Date.now() - started,
    };
  }
}
