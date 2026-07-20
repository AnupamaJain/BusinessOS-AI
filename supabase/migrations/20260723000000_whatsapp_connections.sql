-- ============================================================================
-- Per-organization WhatsApp connections (multi-tenant Embedded Signup).
-- Each SMB that completes Embedded Signup gets a row here; the gateway routes
-- inbound webhooks by phone_number_id and replies with that org's token.
-- ============================================================================
CREATE TABLE whatsapp_connections (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'meta' CHECK (provider IN ('meta', 'twilio')),
  waba_id TEXT CHECK (char_length(waba_id) <= 64),
  phone_number_id TEXT NOT NULL CHECK (char_length(phone_number_id) <= 64),
  display_phone_number TEXT CHECK (char_length(display_phone_number) <= 32),
  verified_name TEXT CHECK (char_length(verified_name) <= 255),
  access_token TEXT NOT NULL,             -- long-lived business/system-user token
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'error')),
  connected_by UUID,                       -- auth.users id that ran signup
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider, phone_number_id)
);
CREATE INDEX idx_wa_connections_org ON whatsapp_connections(organization_id);
CREATE INDEX idx_wa_connections_phone ON whatsapp_connections(phone_number_id);

CREATE TRIGGER set_updated_at BEFORE UPDATE ON whatsapp_connections
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

ALTER TABLE whatsapp_connections ENABLE ROW LEVEL SECURITY;
-- Members may SEE their org's connection (without the token, via a view/column grant
-- in the app); the service role (gateway) manages tokens. Never expose access_token
-- to the anon key: only select non-secret columns from the client.
CREATE POLICY wa_connections_select ON whatsapp_connections
  FOR SELECT USING (public.is_member_of(organization_id));
