import type { LLMProvider, LLMCompletionRequest, LLMCompletionResponse } from '../types';

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

/** USD per 1M tokens: [input, output] */
const PRICING: Record<string, [number, number]> = {
  'claude-sonnet-4-5': [3, 15],
  'claude-opus-4-8': [15, 75],
  'claude-haiku-4-5-20251001': [1, 5],
};

function estimateCost(model: string, promptTokens: number, completionTokens: number): number {
  const [inRate, outRate] = PRICING[model] ?? [3, 15];
  return (promptTokens * inRate + completionTokens * outRate) / 1_000_000;
}

/**
 * Direct Anthropic Messages API provider.
 */
export class AnthropicProvider implements LLMProvider {
  public readonly name = 'anthropic' as const;

  constructor(
    private readonly apiKey: string,
    private readonly defaultModel = 'claude-sonnet-4-5',
  ) {}

  async generateCompletion(request: LLMCompletionRequest): Promise<LLMCompletionResponse> {
    const started = Date.now();
    const model = request.model ?? this.defaultModel;

    const systemPrompt = request.messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
    const chatMessages = request.messages
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));

    const body: Record<string, unknown> = {
      model,
      max_tokens: request.maxTokens ?? 1024,
      temperature: request.temperature ?? 0.3,
      messages: chatMessages,
    };
    if (systemPrompt) body['system'] = systemPrompt;
    if (request.tools && request.tools.length > 0) {
      body['tools'] = request.tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters,
      }));
    }

    const response = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'x-api-key': this.apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Anthropic API error ${response.status}: ${errText.slice(0, 500)}`);
    }

    const data = (await response.json()) as {
      content: Array<{ type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> }>;
      usage: { input_tokens: number; output_tokens: number };
      model: string;
    };

    const content = data.content.filter((b) => b.type === 'text').map((b) => b.text ?? '').join('');
    const toolCalls = data.content
      .filter((b) => b.type === 'tool_use')
      .map((b) => ({ id: b.id ?? '', name: b.name ?? '', arguments: b.input ?? {} }));

    const promptTokens = data.usage.input_tokens;
    const completionTokens = data.usage.output_tokens;

    return {
      provider: 'anthropic',
      model: data.model,
      content,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      usage: {
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
        estimatedCostUsd: estimateCost(model, promptTokens, completionTokens),
      },
      latencyMs: Date.now() - started,
    };
  }
}
