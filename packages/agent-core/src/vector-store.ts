import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '@business-os-ai/shared-types';

export interface ChunkRecord {
  id: string;
  organizationId: string;
  documentId: string;
  chunkIndex: number;
  content: string;
  embedding: number[];
}

export interface RetrievedChunk {
  documentId: string;
  chunkId: string;
  content: string;
  score: number;
}

export interface VectorStore {
  /** Register/refresh a document and replace its chunks. Returns the persistent document id. */
  replaceDocumentChunks(params: {
    organizationId: string;
    sourcePath: string;
    title: string;
    chunks: Array<{ content: string; embedding: number[] }>;
  }): Promise<{ documentId: string; chunkCount: number }>;

  search(organizationId: string, queryEmbedding: number[], threshold: number, limit: number): Promise<RetrievedChunk[]>;
}

// ─── In-memory implementation (tests / offline evaluation) ──────────────────

export class InMemoryVectorStore implements VectorStore {
  constructor(private readonly chunks: ChunkRecord[]) {}

  async replaceDocumentChunks(params: {
    organizationId: string;
    sourcePath: string;
    title: string;
    chunks: Array<{ content: string; embedding: number[] }>;
  }): Promise<{ documentId: string; chunkCount: number }> {
    const documentId = `doc_${params.sourcePath.split('/').pop()?.replace('.md', '') ?? params.title}`;
    for (let i = this.chunks.length - 1; i >= 0; i--) {
      if (this.chunks[i]!.organizationId === params.organizationId && this.chunks[i]!.documentId === documentId) {
        this.chunks.splice(i, 1);
      }
    }
    params.chunks.forEach((chunk, i) => {
      this.chunks.push({
        id: `${documentId}_chk_${i}`,
        organizationId: params.organizationId,
        documentId,
        chunkIndex: i,
        content: chunk.content,
        embedding: chunk.embedding,
      });
    });
    return { documentId, chunkCount: params.chunks.length };
  }

  async search(organizationId: string, queryEmbedding: number[], threshold: number, limit: number): Promise<RetrievedChunk[]> {
    const results: RetrievedChunk[] = [];
    for (const chunk of this.chunks) {
      if (chunk.organizationId !== organizationId) continue;
      const score = cosineSimilarity(queryEmbedding, chunk.embedding);
      if (score >= threshold) {
        results.push({ documentId: chunk.documentId, chunkId: chunk.id, content: chunk.content, score });
      }
    }
    return results.sort((a, b) => b.score - a.score).slice(0, limit);
  }
}

export function cosineSimilarity(vecA: number[], vecB: number[]): number {
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

// ─── Supabase pgvector implementation (production) ──────────────────────────

export class SupabaseVectorStore implements VectorStore {
  constructor(private readonly db: SupabaseClient) {}

  async replaceDocumentChunks(params: {
    organizationId: string;
    sourcePath: string;
    title: string;
    chunks: Array<{ content: string; embedding: number[] }>;
  }): Promise<{ documentId: string; chunkCount: number }> {
    // Find or create the knowledge document by source path
    const { data: existing, error: findErr } = await this.db.from('knowledge_documents')
      .select('id')
      .eq('organization_id', params.organizationId)
      .eq('source_path', params.sourcePath)
      .maybeSingle();
    if (findErr) throw new Error(`knowledge_documents lookup failed: ${findErr.message}`);

    let documentId = existing?.id as string | undefined;
    if (!documentId) {
      const { data: created, error: createErr } = await this.db.from('knowledge_documents')
        .insert({ organization_id: params.organizationId, title: params.title, source_path: params.sourcePath, status: 'active' })
        .select('id').single();
      if (createErr || !created) throw new Error(`knowledge_documents insert failed: ${createErr?.message}`);
      documentId = created.id;
    }

    // Replace chunks atomically enough for our purposes: delete then insert
    const { error: deleteErr } = await this.db.from('knowledge_chunks')
      .delete()
      .eq('organization_id', params.organizationId)
      .eq('document_id', documentId);
    if (deleteErr) throw new Error(`knowledge_chunks delete failed: ${deleteErr.message}`);

    if (params.chunks.length > 0) {
      const rows = params.chunks.map((chunk, i) => ({
        organization_id: params.organizationId,
        document_id: documentId,
        chunk_index: i,
        content: chunk.content,
        embedding: chunk.embedding,
      }));
      const { error: insertErr } = await this.db.from('knowledge_chunks').insert(rows);
      if (insertErr) throw new Error(`knowledge_chunks insert failed: ${insertErr.message}`);
    }

    await this.db.from('knowledge_documents')
      .update({ status: 'active' })
      .eq('id', documentId);

    logger.info('Vector store: document chunks replaced', {
      organizationId: params.organizationId,
      sourcePath: params.sourcePath,
      chunkCount: params.chunks.length,
    });

    return { documentId: documentId!, chunkCount: params.chunks.length };
  }

  async search(organizationId: string, queryEmbedding: number[], threshold: number, limit: number): Promise<RetrievedChunk[]> {
    const { data, error } = await this.db.rpc('match_knowledge_chunks', {
      p_organization_id: organizationId,
      p_query_embedding: queryEmbedding,
      p_match_threshold: threshold,
      p_match_count: limit,
    });
    if (error) throw new Error(`match_knowledge_chunks failed: ${error.message}`);
    return ((data ?? []) as Array<{ chunk_id: string; document_id: string; content: string; similarity: number }>).map((r) => ({
      documentId: r.document_id,
      chunkId: r.chunk_id,
      content: r.content,
      score: r.similarity,
    }));
  }
}
