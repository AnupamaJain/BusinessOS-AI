import type { LLMProvider, LLMCompletionRequest, LLMCompletionResponse, LLMProviderName } from './types';
import { logger } from '@business-os-ai/shared-types';

export interface UsageRecord {
  organizationId: string;
  provider: LLMProviderName;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
  latencyMs: number;
}

export type UsageSink = (record: UsageRecord) => Promise<void>;

export class LLMGateway {
  private providers: Map<LLMProviderName, LLMProvider> = new Map();
  /** Real (non-mock) providers, in registration order — first is the default. */
  private realProviders: LLMProviderName[] = [];
  private tenantUsageStats: Map<string, { totalTokens: number; totalCostUsd: number; requestCount: number }> = new Map();
  private readonly usageSink?: UsageSink;

  constructor(options?: { usageSink?: UsageSink }) {
    this.usageSink = options?.usageSink;
    this.registerMockProvider();
  }

  public registerProvider(provider: LLMProvider): void {
    this.providers.set(provider.name, provider);
    if (provider.name !== 'mock' && !this.realProviders.includes(provider.name)) {
      this.realProviders.push(provider.name);
    }
  }

  public get realProviderNames(): LLMProviderName[] {
    return [...this.realProviders];
  }

  public get hasRealProvider(): boolean {
    return this.realProviders.length > 0;
  }

  public async generateCompletion(request: LLMCompletionRequest): Promise<LLMCompletionResponse> {
    // Default to the first registered real provider; mock only when nothing real exists.
    const primaryProviderName = request.preferredProvider ?? this.realProviders[0] ?? 'mock';
    const fallbackProviders: LLMProviderName[] = [...this.realProviders, 'mock' as const];

    const providerOrder: LLMProviderName[] = [
      primaryProviderName,
      ...fallbackProviders.filter((p) => p !== primaryProviderName),
    ];

    let lastError: Error | undefined;

    for (const providerName of providerOrder) {
      // Never silently fall back to mock when a real provider is configured
      // and the caller did not explicitly ask for mock.
      if (providerName === 'mock' && this.hasRealProvider && request.preferredProvider !== 'mock') {
        break;
      }
      const provider = this.providers.get(providerName);
      if (!provider) continue;

      try {
        const response = await provider.generateCompletion(request);
        await this.trackUsage(request.organizationId, response);

        logger.info('LLM completion generated', {
          organizationId: request.organizationId,
          provider: response.provider,
          model: response.model,
          latencyMs: response.latencyMs,
          cost: response.usage.estimatedCostUsd,
        });

        return response;
      } catch (err) {
        lastError = err as Error;
        logger.warn(`LLM provider '${providerName}' failed, trying fallback...`, { error: lastError.message });
      }
    }

    throw new Error(`LLM Gateway failed for org '${request.organizationId}': ${lastError?.message ?? 'No provider available'}`);
  }

  public getTenantUsage(organizationId: string) {
    return this.tenantUsageStats.get(organizationId) ?? { totalTokens: 0, totalCostUsd: 0, requestCount: 0 };
  }

  private async trackUsage(organizationId: string, response: LLMCompletionResponse): Promise<void> {
    const current = this.tenantUsageStats.get(organizationId) ?? { totalTokens: 0, totalCostUsd: 0, requestCount: 0 };
    this.tenantUsageStats.set(organizationId, {
      totalTokens: current.totalTokens + response.usage.totalTokens,
      totalCostUsd: current.totalCostUsd + response.usage.estimatedCostUsd,
      requestCount: current.requestCount + 1,
    });

    if (this.usageSink) {
      try {
        await this.usageSink({
          organizationId,
          provider: response.provider,
          model: response.model,
          promptTokens: response.usage.promptTokens,
          completionTokens: response.usage.completionTokens,
          totalTokens: response.usage.totalTokens,
          estimatedCostUsd: response.usage.estimatedCostUsd,
          latencyMs: response.latencyMs,
        });
      } catch (err) {
        logger.warn('LLM usage sink failed', { error: err instanceof Error ? err.message : String(err) });
      }
    }
  }

  private registerMockProvider(): void {
    this.providers.set('mock', {
      name: 'mock',
      generateCompletion: async (req: LLMCompletionRequest): Promise<LLMCompletionResponse> => {
        const userMessage = req.messages.find((m) => m.role === 'user')?.content ?? '';
        const promptTokens = Math.ceil(userMessage.length / 4) + 50;
        const completionContent = `[BusinessOS AI Agent Response] Thank you for reaching out! Regarding '${userMessage}', our team is happy to help you with complete details.`;
        const completionTokens = Math.ceil(completionContent.length / 4);

        return {
          provider: 'mock',
          model: req.model ?? 'mock-gpt-4o',
          content: completionContent,
          usage: {
            promptTokens,
            completionTokens,
            totalTokens: promptTokens + completionTokens,
            estimatedCostUsd: (promptTokens * 0.000005) + (completionTokens * 0.000015),
          },
          latencyMs: 120,
        };
      },
    });
  }
}
