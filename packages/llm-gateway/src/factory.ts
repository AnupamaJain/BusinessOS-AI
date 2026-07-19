import { LLMGateway, type UsageSink } from './gateway';
import { AnthropicProvider } from './providers/anthropic';
import { OpenAICompatibleProvider } from './providers/openai-compatible';
import { logger } from '@business-os-ai/shared-types';

export const VERCEL_AI_GATEWAY_URL = 'https://ai-gateway.vercel.sh/v1';

/**
 * Builds the production LLM gateway from environment credentials.
 *
 * Registration priority (first registered becomes the default provider):
 *  1. Anthropic direct (ANTHROPIC_API_KEY)
 *  2. Vercel AI Gateway (AI_GATEWAY_API_KEY, or VERCEL_OIDC_TOKEN which is
 *     automatically present on Vercel deployments)
 *  3. OpenAI direct (OPENAI_API_KEY)
 *
 * Throws when no real provider credential exists and allowMockFallback is false —
 * production must never silently answer customers with canned text.
 */
export function createGatewayFromEnv(
  env: Record<string, string | undefined> = process.env,
  options?: { usageSink?: UsageSink; allowMockFallback?: boolean },
): LLMGateway {
  const gateway = new LLMGateway({ usageSink: options?.usageSink });

  if (env['ANTHROPIC_API_KEY']) {
    gateway.registerProvider(new AnthropicProvider(env['ANTHROPIC_API_KEY']));
  }
  // On Vercel (env VERCEL=1) the OIDC token arrives per-request and is surfaced
  // into process.env by middleware — register the provider unconditionally there.
  if (env['AI_GATEWAY_API_KEY'] || env['VERCEL_OIDC_TOKEN'] || env['VERCEL']) {
    gateway.registerProvider(new OpenAICompatibleProvider({
      name: 'gateway',
      baseUrl: env['AI_GATEWAY_BASE_URL'] ?? VERCEL_AI_GATEWAY_URL,
      // Re-read each call: on Vercel, OIDC tokens rotate and are refreshed in env.
      getToken: () => process.env['AI_GATEWAY_API_KEY'] ?? process.env['VERCEL_OIDC_TOKEN'] ?? env['AI_GATEWAY_API_KEY'] ?? env['VERCEL_OIDC_TOKEN'],
      defaultModel: env['AI_GATEWAY_MODEL'] ?? 'anthropic/claude-sonnet-4.5',
    }));
  }
  if (env['OPENAI_API_KEY']) {
    gateway.registerProvider(new OpenAICompatibleProvider({
      name: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      getToken: () => process.env['OPENAI_API_KEY'] ?? env['OPENAI_API_KEY'],
      defaultModel: 'gpt-4o-mini',
    }));
  }

  if (gateway.realProviderNames.length === 0) {
    if (options?.allowMockFallback) {
      logger.warn('LLM gateway: no real provider credentials found — mock provider only. Set ANTHROPIC_API_KEY or AI_GATEWAY_API_KEY.');
    } else {
      throw new Error(
        'No LLM provider credential configured. Set ANTHROPIC_API_KEY, AI_GATEWAY_API_KEY, or OPENAI_API_KEY (on Vercel, OIDC is used automatically).',
      );
    }
  } else {
    logger.info('LLM gateway initialised', { providers: gateway.realProviderNames });
  }

  return gateway;
}
