-- ============================================================================
-- Production merchant onboarding: business-profile fields, an approval status,
-- T&C acceptance, and per-merchant payment credentials.
--
-- Each merchant connects their OWN Razorpay account; the key_secret / webhook_secret
-- columns hold ciphertext (AES-256-GCM via the app-layer SecretBox), mirroring the
-- per-tenant WhatsApp access_token pattern in whatsapp_connections.
-- ============================================================================

-- 1. Business-profile + onboarding fields on organizations.
--    All additive, nullable/defaulted so existing rows keep working.
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS legal_name TEXT;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS business_type TEXT;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS contact_name TEXT;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS contact_phone TEXT;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS city TEXT;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS gst_number TEXT;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS pan TEXT;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS onboarding_status TEXT NOT NULL DEFAULT 'active'
  CHECK (onboarding_status IN ('pending', 'active', 'pending_review', 'suspended'));
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS terms_accepted_at TIMESTAMPTZ;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS terms_version TEXT;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS whatsapp_consent_at TIMESTAMPTZ;

-- 2. Per-organization payment connection (one per org). Mirrors whatsapp_connections.
--    key_secret / webhook_secret store ciphertext; the gateway (service role) writes
--    them and members may only see that a connection exists.
CREATE TABLE payment_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE UNIQUE,
  provider TEXT NOT NULL DEFAULT 'razorpay',
  key_id TEXT NOT NULL,
  key_secret TEXT NOT NULL,               -- ciphertext (per-merchant Razorpay key secret)
  webhook_secret TEXT,                     -- ciphertext, nullable
  mode TEXT CHECK (mode IN ('test', 'live')),
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_payment_connections_org ON payment_connections(organization_id);

CREATE TRIGGER set_updated_at BEFORE UPDATE ON payment_connections
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

ALTER TABLE payment_connections ENABLE ROW LEVEL SECURITY;
-- Members may SEE that their org has a payment connection; the secret columns are
-- ciphertext regardless. The service role (gateway) manages the credentials, so
-- there is no INSERT/UPDATE policy for anon/authenticated.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'payment_connections'
      AND policyname = 'payment_connections_select'
  ) THEN
    CREATE POLICY payment_connections_select ON payment_connections
      FOR SELECT USING (public.is_member_of(organization_id));
  END IF;
END $$;

-- Never expose the ciphertext secret columns to anon/authenticated (service role only).
-- Column-level privileges: revoke table-wide SELECT, re-grant safe columns.
REVOKE SELECT ON payment_connections FROM anon, authenticated;
GRANT SELECT (id, organization_id, provider, key_id, mode, status, created_at, updated_at)
  ON payment_connections TO anon, authenticated;
