# Non-Functional Requirements Specification

## 1. Security & Tenant Isolation
- Every database query must specify `organization_id`.
- Supabase Row-Level Security (RLS) enabled on all 23 database tables.
- Append-only audit log table (`audit_events`) protected against `UPDATE` and `DELETE` via database triggers.

## 2. Performance & Latency SLAs
- Inbound webhook processing: $\le 200\text{ms}$ acknowledgement.
- Agent graph response generation: $\le 2.0\text{s}$ total.
- Vector similarity search: $\le 50\text{ms}$.

## 3. Reliability & Availability
- Idempotency deduplication window: 24 hours.
- Automatic retries with exponential backoff on Meta Cloud API HTTP rate limits.
- Zero data loss for transaction logs and booking records.

## 4. Compliance & Consent Governance
- GDPR/DPDP compliant opt-in and opt-out processing.
- Restricted sending hours (09:00 - 21:00 UTC) for automated campaign broadcasts.
