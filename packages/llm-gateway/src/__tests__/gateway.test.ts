import { describe, it, expect, beforeEach } from 'vitest';
import { LLMGateway } from '../index';

const ORG_A = '11111111-1111-1111-1111-111111111111';

describe('LLMGateway', () => {
  let gateway: LLMGateway;

  beforeEach(() => {
    gateway = new LLMGateway();
  });

  it('generates completions using mock provider and tracks token usage', async () => {
    const response = await gateway.generateCompletion({
      organizationId: ORG_A,
      messages: [{ role: 'user', content: 'What are the Bali packages?' }]
    });

    expect(response.provider).toBe('mock');
    expect(response.content).toContain('Bali packages');
    expect(response.usage.totalTokens).toBeGreaterThan(0);

    const stats = gateway.getTenantUsage(ORG_A);
    expect(stats.requestCount).toBe(1);
    expect(stats.totalTokens).toBe(response.usage.totalTokens);
    expect(stats.totalCostUsd).toBeGreaterThan(0);
  });
});
