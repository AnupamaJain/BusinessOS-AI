-- ============================================================================
-- Per-tenant integration connections: enable UPSERT on (organization_id,
-- provider) and hide the encrypted `config` (holding OAuth tokens / API keys)
-- from the anon/dashboard key. Only the gateway (service role) reads secrets.
-- ============================================================================

-- 1. One connection per org+provider, so credentials UPSERT in place.
ALTER TABLE public.integration_connections
  ADD CONSTRAINT integration_connections_org_provider_key
  UNIQUE (organization_id, provider);

-- 2. Never expose the secret-bearing `config` column to anon/authenticated
--    (service role only). Column-level privileges: revoke table-wide SELECT,
--    re-grant the non-secret columns. Mirrors the whatsapp_connections pattern
--    in 20260724000000_hardening.sql. RLS is left as-is.
REVOKE SELECT ON public.integration_connections FROM anon, authenticated;
GRANT SELECT (id, organization_id, provider, status, created_at, updated_at)
  ON public.integration_connections TO anon, authenticated;
