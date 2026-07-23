import { z } from 'zod';

/**
 * Environment variable schema.
 * Validates all required and optional env vars at startup.
 * Real secrets are never hardcoded; see .env.example for reference.
 */
export const envSchema = z.object({
  // Supabase
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),

  // LLM providers
  ANTHROPIC_API_KEY: z.string().min(1),
  OPENAI_API_KEY: z.string().optional(),

  // Meta / WhatsApp
  META_APP_ID: z.string().min(1),
  META_APP_SECRET: z.string().min(1),
  META_VERIFY_TOKEN: z.string().min(1),
  META_WHATSAPP_PHONE_NUMBER_ID: z.string().min(1),
  META_WHATSAPP_ACCESS_TOKEN: z.string().min(1),

  // Observability (optional initially)
  LANGFUSE_PUBLIC_KEY: z.string().optional(),
  LANGFUSE_SECRET_KEY: z.string().optional(),

  // Application
  APP_BASE_URL: z.string().url().default('http://localhost:3000'),

  // Feature flags
  ENABLE_MOCK_WHATSAPP: z
    .string()
    .transform((v) => v === 'true')
    .default('true'),
  ENABLE_DRY_RUN_AUTOMATION: z
    .string()
    .transform((v) => v === 'true')
    .default('true'),

  // OpenMontage AI Video & Media Generation Providers (optional)
  FAL_KEY: z.string().optional(),
  FAL_AI_API_KEY: z.string().optional(),
  REPLICATE_API_TOKEN: z.string().optional(),
  KLING_API_KEY: z.string().optional(),
  KLING_API_BASE_URL: z.string().optional(),
  ATLASCLOUD_API_KEY: z.string().optional(),
  HIGGSFIELD_KEY: z.string().optional(),
  PEXELS_API_KEY: z.string().optional(),
  PIXABAY_API_KEY: z.string().optional(),
  UNSPLASH_ACCESS_KEY: z.string().optional(),
  SUNO_API_KEY: z.string().optional(),
  ELEVENLABS_API_KEY: z.string().optional(),
});

export type EnvConfig = z.infer<typeof envSchema>;

/**
 * Parse and validate environment variables.
 * Throws a descriptive error if required variables are missing.
 */
export function parseEnv(env: Record<string, string | undefined>): EnvConfig {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    const formatted = result.error.issues
      .map((issue) => `  ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Environment validation failed:\n${formatted}`);
  }
  return result.data;
}
