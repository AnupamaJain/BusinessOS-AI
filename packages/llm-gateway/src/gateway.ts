import type { LLMProvider, LLMCompletionRequest, LLMCompletionResponse, LLMProviderName } from './types';
import { logger } from '@business-os-ai/shared-types';

export class LLMGateway {
  private providers: Map<LLMProviderName, LLMProvider> = new Map();
  private tenantUsageStats: Map<string, { totalTokens: number; totalCostUsd: number; requestCount: number }> = new Map();

  constructor() {
    this.registerMockProvider();
  }

  public registerProvider(provider: LLMProvider): void {
    this.providers.set(provider.name, provider);
  }

  public async generateCompletion(request: LLMCompletionRequest): Promise<LLMCompletionResponse> {
    const primaryProviderName = request.preferredProvider ?? 'mock';
    const fallbackProviders: LLMProviderName[] = ['mock'];

    const providerOrder: LLMProviderName[] = [
      primaryProviderName,
      ...fallbackProviders.filter(p => p !== primaryProviderName)
    ];

    let lastError: Error | undefined;

    for (const providerName of providerOrder) {
      const provider = this.providers.get(providerName);
      if (!provider) continue;

      try {
        const response = await provider.generateCompletion(request);
        this.trackUsage(request.organizationId, response.usage.totalTokens, response.usage.estimatedCostUsd);
        
        logger.info('LLM completion generated', {
          organizationId: request.organizationId,
          provider: response.provider,
          model: response.model,
          latencyMs: response.latencyMs,
          cost: response.usage.estimatedCostUsd
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

  private trackUsage(organizationId: string, tokens: number, costUsd: number): void {
    const current = this.tenantUsageStats.get(organizationId) ?? { totalTokens: 0, totalCostUsd: 0, requestCount: 0 };
    this.tenantUsageStats.set(organizationId, {
      totalTokens: current.totalTokens + tokens,
      totalCostUsd: current.totalCostUsd + costUsd,
      requestCount: current.requestCount + 1
    });
  }

  private registerMockProvider(): void {
    this.registerProvider({
      name: 'mock',
      generateCompletion: async (req: LLMCompletionRequest): Promise<LLMCompletionResponse> => {
        const userMessage = req.messages.find(m => m.role === 'user')?.content ?? '';
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
            estimatedCostUsd: (promptTokens * 0.000005) + (completionTokens * 0.000015)
          },
          latencyMs: 120
        };
      }
    });
  }
}
