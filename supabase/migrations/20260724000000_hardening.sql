-- ============================================================================
-- Production hardening: hide secret token column from clients, error sink,
-- and per-org monthly LLM spend accounting helper.
-- ============================================================================

-- 1. Never expose access_token to anon/authenticated (service role only).
--    Column-level privileges: revoke table-wide SELECT, re-grant safe columns.
REVOKE SELECT ON whatsapp_connections FROM anon, authenticated;
GRANT SELECT (id, organization_id, provider, waba_id, phone_number_id,
              display_phone_number, verified_name, status, created_at, updated_at)
  ON whatsapp_connections TO anon, authenticated;

-- 2. Durable error / incident sink for observability + alerting.
CREATE TABLE error_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (char_length(source) <= 100),
  severity TEXT NOT NULL DEFAULT 'error' CHECK (severity IN ('info', 'warning', 'error', 'critical')),
  message TEXT NOT NULL,
  context JSONB DEFAULT '{}',
  trace_id TEXT CHECK (char_length(trace_id) <= 255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_error_events_created ON error_events(created_at);
CREATE INDEX idx_error_events_org ON error_events(organization_id);
ALTER TABLE error_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY error_events_select ON error_events
  FOR SELECT USING (organization_id IS NOT NULL AND public.is_member_of(organization_id));

-- 3. Per-org monthly LLM spend (for cost caps). SECURITY DEFINER so the gateway
--    can enforce caps cheaply.
CREATE OR REPLACE FUNCTION public.org_llm_spend_this_month(p_org UUID)
RETURNS NUMERIC AS $$
  SELECT COALESCE(SUM(estimated_cost_usd), 0)
  FROM llm_usage
  WHERE organization_id = p_org
    AND created_at >= date_trunc('month', now());
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- 4. Per-org billing state (subscription plan).
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS plan TEXT DEFAULT 'free' CHECK (char_length(plan) <= 40);
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS subscription_status TEXT;
