import { MockEmbeddingProvider } from './mock-embedding';
import { logger } from '@whatsapp-smb/shared-types';
import type { ToolDataStore } from '@whatsapp-smb/mcp-business-tools';
import * as fs from 'fs';
import * as path from 'path';

export interface EmbeddingProvider {
  getEmbedding(text: string): Promise<number[]>;
}

/**
 * Basic markdown chunker.
 * Splits text into paragraphs, building chunks with configured max size and overlap.
 */
export function chunkMarkdown(text: string, maxChars = 500, overlap = 100): string[] {
  const paragraphs = text.split(/\n{2,}/);
  const chunks: string[] = [];
  let currentChunk = '';

  for (const para of paragraphs) {
    if (para.trim().length === 0) continue;
    if (currentChunk.length + para.length > maxChars) {
      if (currentChunk.trim()) {
        chunks.push(currentChunk.trim());
      }
      currentChunk = (overlap > 0 ? currentChunk.slice(-overlap) : '') + '\n\n' + para;
    } else {
      currentChunk += (currentChunk ? '\n\n' : '') + para;
    }
  }
  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }
  return chunks;
}

/**
 * Ingestion runner.
 * Reads markdown documents from a directory, chunks them, generates embeddings,
 * and stores them in the given ToolDataStore (simulating Supabase pgvector).
 */
export async function ingestMarkdownDocuments(
  store: ToolDataStore,
  organizationId: string,
  baseDir: string,
  embedder: EmbeddingProvider = new MockEmbeddingProvider(),
): Promise<void> {
  if (!fs.existsSync(baseDir)) {
    logger.warn('Ingestion base directory does not exist', { baseDir });
    return;
  }

  const files = fs.readdirSync(baseDir).filter((f) => f.endsWith('.md'));
  for (const file of files) {
    const fullPath = path.join(baseDir, file);
    const content = fs.readFileSync(fullPath, 'utf-8');
    const docId = `doc_${file.replace('.md', '')}`;

    // Add document to store
    store.products.push({
      sku: docId,
      name: file.replace('.md', '').toUpperCase(),
      price: '',
      skinType: '',
      description: `Document: ${file}`,
      suitableFor: '',
      organizationId,
    });

    const chunks = chunkMarkdown(content);
    for (let i = 0; i < chunks.length; i++) {
      const chunkText = chunks[i]!;
      const embedding = await embedder.getEmbedding(chunkText);

      // Simulate storing chunk
      // In real code, we insert into `knowledge_chunks` table with pgvector
      // We will model store.auditEvents or a mock collection for retrieval
      // Let's store chunk inside auditEvents or as a custom structure in store.
      // Wait, we can reuse store's list of products as documents, or save in custom store property.
      // To simulate retrieve without changing MCP ToolDataStore type, we can add a custom array mapping
      // or associate with the document. Let's record the chunk directly in ToolDataStore or via a global mock.
      simulatedChunks.push({
        id: `${docId}_chk_${i}`,
        organizationId,
        documentId: docId,
        content: chunkText,
        embedding,
      });
    }
  }

  logger.info('Ingested markdown documents', { organizationId, documentCount: files.length, totalChunks: simulatedChunks.length });
}

// Simulated table for local tests
export const simulatedChunks: Array<{
  id: string;
  organizationId: string;
  documentId: string;
  content: string;
  embedding: number[];
}> = [];

/**
 * Tenant-scoped cosine similarity retrieval.
 * Computes cosine similarity against simulated chunks.
 */
export async function retrieveRelevantChunks(
  organizationId: string,
  query: string,
  threshold = 0.7,
  limit = 3,
  embedder: EmbeddingProvider = new MockEmbeddingProvider(),
): Promise<Array<{ documentId: string; chunkId: string; content: string; score: number }>> {
  const queryVec = await embedder.getEmbedding(query);
  const results: Array<{ documentId: string; chunkId: string; content: string; score: number }> = [];

  const tenantChunks = simulatedChunks.filter((c) => c.organizationId === organizationId);
  for (const chunk of tenantChunks) {
    const score = cosineSimilarity(queryVec, chunk.embedding);
    if (score >= threshold) {
      results.push({
        documentId: chunk.documentId,
        chunkId: chunk.id,
        content: chunk.content,
        score,
      });
    }
  }

  // Sort by score descending and take limit
  return results.sort((a, b) => b.score - a.score).slice(0, limit);
}

function cosineSimilarity(vecA: number[], vecB: number[]): number {
  if (vecA.length !== vecB.length) return 0;
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i]! * vecB[i]!;
    normA += vecA[i]! * vecA[i]!;
    normB += vecB[i]! * vecB[i]!;
  }
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}
