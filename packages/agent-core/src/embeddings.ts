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

/** Target dimensionality — must match the knowledge_chunks vector(1536) column. */
const EMBEDDING_DIMS = 1536;

/**
 * Google Gemini embedding provider (native API).
 * Uses gemini-embedding-001 with outputDimensionality=1536 so vectors match the
 * pgvector schema. Free tier via a Google AI Studio API key.
 */
export class GoogleEmbeddingProvider implements EmbeddingProvider {
  constructor(private readonly config: { getToken: () => string | undefined; model: string }) {}

  async getEmbedding(text: string): Promise<number[]> {
    const key = this.config.getToken();
    if (!key) throw new Error('No Google API key available for embeddings.');
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.config.model}:embedContent?key=${key}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: `models/${this.config.model}`,
        content: { parts: [{ text }] },
        outputDimensionality: EMBEDDING_DIMS,
      }),
    });
    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Google embedding API error ${response.status}: ${errText.slice(0, 300)}`);
    }
    const data = (await response.json()) as { embedding?: { values?: number[] } };
    const values = data.embedding?.values;
    if (!values || values.length === 0) throw new Error('Google embedding API returned no vector.');
    return values;
  }
}

/**
 * Resolve a real embedding provider from environment credentials, or null when
 * none is configured (callers decide whether that is fatal).
 *
 * Preference: OpenAI / AI Gateway (native 1536) → Google Gemini (1536 via MRL).
 */
export function createEmbeddingProviderFromEnv(
  env: Record<string, string | undefined> = process.env,
): EmbeddingProvider | null {
  if (env['OPENAI_API_KEY']) {
    return new OpenAICompatibleEmbeddingProvider({
      baseUrl: 'https://api.openai.com/v1',
      getToken: () => process.env['OPENAI_API_KEY'] ?? env['OPENAI_API_KEY'],
      model: 'text-embedding-3-small',
    });
  }
  if (env['AI_GATEWAY_API_KEY']) {
    return new OpenAICompatibleEmbeddingProvider({
      baseUrl: env['AI_GATEWAY_BASE_URL'] ?? 'https://ai-gateway.vercel.sh/v1',
      getToken: () => process.env['AI_GATEWAY_API_KEY'] ?? env['AI_GATEWAY_API_KEY'],
      model: env['EMBEDDING_MODEL'] ?? 'openai/text-embedding-3-small',
    });
  }
  if (env['GOOGLE_API_KEY'] || env['GEMINI_API_KEY']) {
    return new GoogleEmbeddingProvider({
      getToken: () => process.env['GOOGLE_API_KEY'] ?? process.env['GEMINI_API_KEY'] ?? env['GOOGLE_API_KEY'] ?? env['GEMINI_API_KEY'],
      model: env['GOOGLE_EMBEDDING_MODEL'] ?? 'gemini-embedding-001',
    });
  }
  return null;
}
