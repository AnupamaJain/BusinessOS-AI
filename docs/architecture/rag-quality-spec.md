# RAG Retrieval Quality Specification

To deliver safe, relevant, and accurate answers, the platform implements a retrieval-augmented generation (RAG) pipeline optimized for D2C skincare workflows.

---

## 1. Document Ingestion & Chunking Strategy

Documents are parsed from raw markdown formats to preserve logical formatting boundaries:

- **Paragraph & List Chunking**:
  - The document is split by paragraphs (separated by double newlines `\n\n`) and headers (`#`, `##`, `###`).
  - This preserves context cohesion (e.g. keeps a specific product pricing list, shipping zones, or medical warnings intact).
- **Size & Overlap Parameters**:
  - Max chunk size: **500 characters**.
  - Chunk overlap: **100 characters** (providing boundary context sharing).
  - Explicit safety substitution prevents paragraph concatenation bugs on zero-overlap parameters.

---

## 2. Mock Semantic Embedding Alignment

We utilize a deterministic word-hash vector model (`MockEmbeddingProvider`) to run local testing without network latencies:

- Text is tokenized into lowercase alphanumeric words.
- Each word is hashed to map to an index slot in a 1536-dimensional float vector:
  $$\text{index} = \text{hash}(word) \pmod{1536}$$
- We normalize vectors to unit length:
  $$\vec{v}_{norm} = \frac{\vec{v}}{\|\vec{v}\|}$$
- This guarantees cosine similarity scoring corresponds to the word overlap density.
- Match similarity thresholds are calibrated to `0.01` to filter out unrelated noise while allowing partial matches (such as shipping zones).

---

## 3. Policy Grounding Validation

Before generating any user-facing response from the FAQ knowledge base, the policy engine runs the **Grounding Check**:

```typescript
export function checkGrounding(
  sources: AgentState['retrievedSources'], 
  threshold = 0.01
): boolean {
  if (sources.length === 0) return false;
  return sources.some((s) => s.score >= threshold);
}
```

- **Insufficient Grounding Action**:
  - If no ingested chunk meets the threshold, the policy engine rejects the response (`allowed: false`) and sets the escalation reason to `insufficient_grounding`.
  - The conversation is claimed by the handoff flow and routed to a human operator.
  - This prevents the agent from hallucinating skincare advice.
