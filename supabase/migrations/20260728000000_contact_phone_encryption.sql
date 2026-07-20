-- ============================================================================
-- Phone-number encryption at rest for contacts.
--
-- The phone number is crown-jewel PII (it is how a customer can be reached or
-- spammed), so a DB leak must not expose full numbers. When encryption is
-- enabled the app stores the AES-256-GCM ciphertext of the real E.164 phone in
-- `phone_enc`, a keyed HMAC blind index in `phone_bidx` (for equality lookups
-- without exposing plaintext), and a masked value in `phone_number` (e.g.
-- `+91••••••7368`) — so a raw dump / the dashboard's anon-key reads never see a
-- reachable number.
--
-- Backwards compatible: columns are nullable, so legacy rows and local/dev
-- (no ENCRYPTION_KEY) keep storing the real number in `phone_number`.
-- ============================================================================

alter table public.contacts add column if not exists phone_enc text;
alter table public.contacts add column if not exists phone_bidx text;

create index if not exists idx_contacts_phone_bidx
  on public.contacts (organization_id, phone_bidx);
