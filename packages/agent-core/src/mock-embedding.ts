import type { EmbeddingProvider } from './rag';

/**
 * Semantic-like Mock Embedding Provider for local tests and CI.
 * Produces a stable, normalized 1536-dimensional vector for any text.
 * Uses a word-hashing approach so that overlapping words result in high cosine similarity.
 */
export class MockEmbeddingProvider implements EmbeddingProvider {
  async getEmbedding(text: string): Promise<number[]> {
    const dimension = 1536;
    const vec = new Array<number>(dimension).fill(0);

    // Split text into words (alphanumeric only)
    const words = text.toLowerCase().split(/[^a-z0-9]+/);

    for (const word of words) {
      if (word.length < 2) continue;
      
      // Calculate a simple hash for each word
      let hash = 0;
      for (let i = 0; i < word.length; i++) {
        hash = (hash * 31 + word.charCodeAt(i)) % dimension;
      }
      
      // Accumulate weight in the index corresponding to the word
      vec[hash] = (vec[hash] ?? 0) + 10.0;
    }

    // No baseline noise to ensure clear keyword-based cosine similarity
    const norm = Math.sqrt(vec.reduce((sum, val) => sum + val * val, 0));
    return vec.map((val) => (norm === 0 ? 0 : val / norm));
  }
}
