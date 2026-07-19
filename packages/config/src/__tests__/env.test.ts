import { describe, it, expect } from 'vitest';
import { parseEnv } from '../env';

describe('envSchema', () => {
  const validEnv = {
    NEXT_PUBLIC_SUPABASE_URL: 'http://localhost:54321',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'test-anon-key',
    SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
    ANTHROPIC_API_KEY: 'sk-ant-test-key',
    META_APP_ID: 'test-app-id',
    META_APP_SECRET: 'test-app-secret',
    META_VERIFY_TOKEN: 'test-verify-token',
    META_WHATSAPP_PHONE_NUMBER_ID: 'test-phone-id',
    META_WHATSAPP_ACCESS_TOKEN: 'test-access-token',
    APP_BASE_URL: 'http://localhost:3000',
    ENABLE_MOCK_WHATSAPP: 'true',
    ENABLE_DRY_RUN_AUTOMATION: 'true',
  };

  it('parses valid environment variables', () => {
    const result = parseEnv(validEnv);
    expect(result.NEXT_PUBLIC_SUPABASE_URL).toBe('http://localhost:54321');
    expect(result.ANTHROPIC_API_KEY).toBe('sk-ant-test-key');
    expect(result.ENABLE_MOCK_WHATSAPP).toBe(true);
    expect(result.ENABLE_DRY_RUN_AUTOMATION).toBe(true);
  });

  it('applies defaults for optional fields', () => {
    const result = parseEnv(validEnv);
    expect(result.OPENAI_API_KEY).toBeUndefined();
    expect(result.LANGFUSE_PUBLIC_KEY).toBeUndefined();
  });

  it('rejects missing required SUPABASE_URL', () => {
    const { NEXT_PUBLIC_SUPABASE_URL: _, ...incomplete } = validEnv;
    expect(() => parseEnv(incomplete)).toThrow('Environment validation failed');
  });

  it('rejects missing required ANTHROPIC_API_KEY', () => {
    const { ANTHROPIC_API_KEY: _, ...incomplete } = validEnv;
    expect(() => parseEnv(incomplete)).toThrow('Environment validation failed');
  });

  it('rejects invalid URL for SUPABASE_URL', () => {
    expect(() =>
      parseEnv({ ...validEnv, NEXT_PUBLIC_SUPABASE_URL: 'not-a-url' }),
    ).toThrow('Environment validation failed');
  });

  it('transforms ENABLE_MOCK_WHATSAPP string to boolean', () => {
    const result = parseEnv({ ...validEnv, ENABLE_MOCK_WHATSAPP: 'false' });
    expect(result.ENABLE_MOCK_WHATSAPP).toBe(false);
  });

  it('transforms ENABLE_DRY_RUN_AUTOMATION string to boolean', () => {
    const result = parseEnv({
      ...validEnv,
      ENABLE_DRY_RUN_AUTOMATION: 'false',
    });
    expect(result.ENABLE_DRY_RUN_AUTOMATION).toBe(false);
  });

  it('accepts optional OPENAI_API_KEY when provided', () => {
    const result = parseEnv({
      ...validEnv,
      OPENAI_API_KEY: 'sk-test-openai',
    });
    expect(result.OPENAI_API_KEY).toBe('sk-test-openai');
  });
});
