import { MockEmbeddingProvider } from './mock-embedding';
import { logger } from '@business-os-ai/shared-types';
import type { ToolDataStore } from '@business-os-ai/mcp-business-tools';
import { InMemoryVectorStore, type VectorStore, type ChunkRecord, type RetrievedChunk } from './vector-store';
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

/** In-memory chunk table used by tests and offline evaluation. */
export const simulatedChunks: ChunkRecord[] = [];

const defaultVectorStore = new InMemoryVectorStore(simulatedChunks);

/**
 * Ingest markdown documents provided as content strings.
 * Chunks each document, embeds every chunk, and replaces the document's chunks
 * in the vector store (pgvector in production, in-memory for tests).
 */
export async function ingestMarkdownContent(
  organizationId: string,
  documents: Array<{ title: string; sourcePath: string; content: string }>,
  embedder: EmbeddingProvider = new MockEmbeddingProvider(),
  vectorStore: VectorStore = defaultVectorStore,
): Promise<{ documentCount: number; chunkCount: number }> {
  let totalChunks = 0;
  for (const doc of documents) {
    const chunks = chunkMarkdown(doc.content);
    const embedded: Array<{ content: string; embedding: number[] }> = [];
    for (const chunkText of chunks) {
      const embedding = await embedder.getEmbedding(chunkText);
      embedded.push({ content: chunkText, embedding });
    }
    const result = await vectorStore.replaceDocumentChunks({
      organizationId,
      sourcePath: doc.sourcePath,
      title: doc.title,
      chunks: embedded,
    });
    totalChunks += result.chunkCount;
  }

  logger.info('Ingested markdown documents', { organizationId, documentCount: documents.length, totalChunks });
  return { documentCount: documents.length, chunkCount: totalChunks };
}

/**
 * Ingestion runner over a directory of markdown files.
 */
export async function ingestMarkdownDocuments(
  _store: ToolDataStore,
  organizationId: string,
  baseDir: string,
  embedder: EmbeddingProvider = new MockEmbeddingProvider(),
  vectorStore: VectorStore = defaultVectorStore,
): Promise<void> {
  if (!fs.existsSync(baseDir)) {
    logger.warn('Ingestion base directory does not exist', { baseDir });
    return;
  }

  const files = fs.readdirSync(baseDir).filter((f) => f.endsWith('.md'));
  const documents = files.map((file) => ({
    title: file.replace('.md', '').toUpperCase(),
    sourcePath: file,
    content: fs.readFileSync(path.join(baseDir, file), 'utf-8'),
  }));

  await ingestMarkdownContent(organizationId, documents, embedder, vectorStore);
}

/**
 * Tenant-scoped similarity retrieval over the vector store.
 */
export async function retrieveRelevantChunks(
  organizationId: string,
  query: string,
  threshold = 0.7,
  limit = 3,
  embedder: EmbeddingProvider = new MockEmbeddingProvider(),
  vectorStore: VectorStore = defaultVectorStore,
): Promise<RetrievedChunk[]> {
  const queryVec = await embedder.getEmbedding(query);
  return vectorStore.search(organizationId, queryVec, threshold, limit);
}
