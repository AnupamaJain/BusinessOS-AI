import type { EmbeddingProvider } from './rag';

/**
 * Real embedding provider for any OpenAI-compatible /embeddings endpoint.
 *
 * Production default: Vercel AI Gateway with model openai/text-embedding-3-small
 * (1536 dimensions — matches the knowledge_chunks vector(1536) column).
 */
export class OpenAICompatibleEmbeddingProvider implements EmbeddingProvider {
  constructor(private readonly config: {
    baseUrl: string;
    getToken: () => string | undefined;
    model: string;
  }) {}

  async getEmbedding(text: string): Promise<number[]> {
    const token = this.config.getToken();
    if (!token) {
      throw new Error('No credential available for embedding provider.');
    }

    const response = await fetch(`${this.config.baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: this.config.model, input: text }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Embedding API error ${response.status}: ${errText.slice(0, 300)}`);
    }

    const data = (await response.json()) as { data: Array<{ embedding: number[] }> };
    const embedding = data.data[0]?.embedding;
    if (!embedding || embedding.length === 0) {
      throw new Error('Embedding API returned no vector.');
    }
    return embedding;
  }
}

/**
 * Resolve a real embedding provider from environment credentials, or null when
 * none is configured (callers decide whether that is fatal).
 */
export function createEmbeddingProviderFromEnv(
  env: Record<string, string | undefined> = process.env,
): EmbeddingProvider | null {
  // On Vercel (env VERCEL=1) the OIDC token arrives per-request and is surfaced
  // into process.env by middleware — register the provider unconditionally there.
  if (env['AI_GATEWAY_API_KEY'] || env['VERCEL_OIDC_TOKEN'] || env['VERCEL']) {
    return new OpenAICompatibleEmbeddingProvider({
      baseUrl: env['AI_GATEWAY_BASE_URL'] ?? 'https://ai-gateway.vercel.sh/v1',
      getToken: () => process.env['AI_GATEWAY_API_KEY'] ?? process.env['VERCEL_OIDC_TOKEN'] ?? env['AI_GATEWAY_API_KEY'] ?? env['VERCEL_OIDC_TOKEN'],
      model: env['EMBEDDING_MODEL'] ?? 'openai/text-embedding-3-small',
    });
  }
  if (env['OPENAI_API_KEY']) {
    return new OpenAICompatibleEmbeddingProvider({
      baseUrl: 'https://api.openai.com/v1',
      getToken: () => process.env['OPENAI_API_KEY'] ?? env['OPENAI_API_KEY'],
      model: 'text-embedding-3-small',
    });
  }
  return null;
}
