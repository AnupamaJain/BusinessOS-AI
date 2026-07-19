import { LLMGateway, type UsageSink } from './gateway';
import { AnthropicProvider } from './providers/anthropic';
import { OpenAICompatibleProvider } from './providers/openai-compatible';
import { logger } from '@business-os-ai/shared-types';

export const VERCEL_AI_GATEWAY_URL = 'https://ai-gateway.vercel.sh/v1';

/**
 * Builds the production LLM gateway from environment credentials.
 *
 * The FIRST registered real provider becomes the default; the rest form the
 * failover chain (so if a free provider is rate-limited, the next one answers).
 * Order:
 *  1. Anthropic direct (ANTHROPIC_API_KEY)
 *  2. Groq (GROQ_API_KEY) — free, fast
 *  3. Google Gemini (GOOGLE_API_KEY / GEMINI_API_KEY) — free tier
 *  4. OpenRouter (OPENROUTER_API_KEY) — free models
 *  5. OpenAI direct (OPENAI_API_KEY)
 *  6. Vercel AI Gateway (AI_GATEWAY_API_KEY / OIDC) — last, needs billing enabled
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

  if (env['GROQ_API_KEY']) {
    gateway.registerProvider(new OpenAICompatibleProvider({
      name: 'groq',
      baseUrl: 'https://api.groq.com/openai/v1',
      getToken: () => process.env['GROQ_API_KEY'] ?? env['GROQ_API_KEY'],
      defaultModel: env['GROQ_MODEL'] ?? 'llama-3.3-70b-versatile',
    }));
  }

  if (env['GOOGLE_API_KEY'] || env['GEMINI_API_KEY']) {
    gateway.registerProvider(new OpenAICompatibleProvider({
      name: 'google',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
      getToken: () => process.env['GOOGLE_API_KEY'] ?? process.env['GEMINI_API_KEY'] ?? env['GOOGLE_API_KEY'] ?? env['GEMINI_API_KEY'],
      defaultModel: env['GOOGLE_MODEL'] ?? 'gemini-2.0-flash',
    }));
  }

  if (env['OPENROUTER_API_KEY']) {
    gateway.registerProvider(new OpenAICompatibleProvider({
      name: 'openrouter',
      baseUrl: 'https://openrouter.ai/api/v1',
      getToken: () => process.env['OPENROUTER_API_KEY'] ?? env['OPENROUTER_API_KEY'],
      defaultModel: env['OPENROUTER_MODEL'] ?? 'meta-llama/llama-3.3-70b-instruct:free',
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

  // Vercel AI Gateway (OIDC) — registered LAST so it is only a fallback; it
  // requires billing enabled on the Vercel team (otherwise returns 403).
  if (env['AI_GATEWAY_API_KEY'] || (env['VERCEL'] && env['ENABLE_AI_GATEWAY'] === 'true')) {
    gateway.registerProvider(new OpenAICompatibleProvider({
      name: 'gateway',
      baseUrl: env['AI_GATEWAY_BASE_URL'] ?? VERCEL_AI_GATEWAY_URL,
      getToken: () => process.env['AI_GATEWAY_API_KEY'] ?? process.env['VERCEL_OIDC_TOKEN'] ?? env['AI_GATEWAY_API_KEY'] ?? env['VERCEL_OIDC_TOKEN'],
      defaultModel: env['AI_GATEWAY_MODEL'] ?? 'anthropic/claude-sonnet-4.5',
    }));
  }

  if (gateway.realProviderNames.length === 0) {
    if (options?.allowMockFallback) {
      logger.warn('LLM gateway: no real provider credentials found — mock provider only. Set GROQ_API_KEY, GOOGLE_API_KEY, OPENROUTER_API_KEY, or ANTHROPIC_API_KEY.');
    } else {
      throw new Error(
        'No LLM provider credential configured. Set GROQ_API_KEY, GOOGLE_API_KEY, OPENROUTER_API_KEY, ANTHROPIC_API_KEY, or OPENAI_API_KEY.',
      );
    }
  } else {
    logger.info('LLM gateway initialised', { providers: gateway.realProviderNames });
  }

  return gateway;
}
