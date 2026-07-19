-- ============================================================================
-- Production hardening: durable webhook dedup, pgvector retrieval RPC,
-- LLM usage tracking, and vector index.
-- ============================================================================

-- ============================================================================
-- 1. webhook_events — durable idempotency for inbound provider events
-- ============================================================================
CREATE TABLE webhook_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  provider TEXT NOT NULL DEFAULT 'whatsapp' CHECK (char_length(provider) <= 50),
  provider_message_id TEXT NOT NULL CHECK (char_length(provider_message_id) <= 255),
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  payload JSONB DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'received' CHECK (status IN ('received', 'processed', 'failed')),
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ,
  UNIQUE (provider, provider_message_id)
);
CREATE INDEX idx_webhook_events_org ON webhook_events(organization_id);
CREATE INDEX idx_webhook_events_status ON webhook_events(status);

ALTER TABLE webhook_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY webhook_events_select ON webhook_events
  FOR SELECT USING (organization_id IS NOT NULL AND public.is_member_of(organization_id));

-- ============================================================================
-- 2. llm_usage — per-tenant LLM cost & token accounting
-- ============================================================================
CREATE TABLE llm_usage (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (char_length(provider) <= 50),
  model TEXT NOT NULL CHECK (char_length(model) <= 100),
  purpose TEXT NOT NULL DEFAULT 'completion' CHECK (purpose IN ('completion', 'intent', 'embedding', 'evaluation')),
  prompt_tokens INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  estimated_cost_usd NUMERIC(12, 8) NOT NULL DEFAULT 0,
  latency_ms INTEGER,
  trace_id TEXT CHECK (char_length(trace_id) <= 255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_llm_usage_org ON llm_usage(organization_id);
CREATE INDEX idx_llm_usage_created ON llm_usage(created_at);

ALTER TABLE llm_usage ENABLE ROW LEVEL SECURITY;
CREATE POLICY llm_usage_select ON llm_usage
  FOR SELECT USING (public.is_member_of(organization_id));

-- ============================================================================
-- 3. match_knowledge_chunks — tenant-scoped pgvector similarity search
-- ============================================================================
CREATE OR REPLACE FUNCTION public.match_knowledge_chunks(
  p_organization_id UUID,
  p_query_embedding vector(1536),
  p_match_threshold FLOAT DEFAULT 0.3,
  p_match_count INT DEFAULT 3
)
RETURNS TABLE (
  chunk_id UUID,
  document_id UUID,
  content TEXT,
  similarity FLOAT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    kc.id AS chunk_id,
    kc.document_id,
    kc.content,
    1 - (kc.embedding <=> p_query_embedding) AS similarity
  FROM knowledge_chunks kc
  WHERE kc.organization_id = p_organization_id
    AND kc.embedding IS NOT NULL
    AND 1 - (kc.embedding <=> p_query_embedding) >= p_match_threshold
  ORDER BY kc.embedding <=> p_query_embedding
  LIMIT p_match_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- ANN index for chunk retrieval (cosine distance)
CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_embedding
  ON knowledge_chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- ============================================================================
-- 4. payments hardening — provider linkage for Razorpay payment links
-- ============================================================================
ALTER TABLE payments ADD COLUMN IF NOT EXISTS provider_link_id TEXT CHECK (char_length(provider_link_id) <= 255);
ALTER TABLE payments ADD COLUMN IF NOT EXISTS payment_link_url TEXT;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_payments_provider_link ON payments(provider_link_id);
