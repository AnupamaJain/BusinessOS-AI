# Multi-Tenancy & Data Isolation

_Last reviewed: 2026-07-21_

SaarthiOne is a multi-tenant SaaS: many independent businesses ("organizations")
share one database and one gateway. Tenant isolation is enforced in **four
layers**, so no single mistake can leak one tenant's data to another.

## 1. Every row is org-owned
Every business table carries `organization_id`. There is no un-scoped tenant
data anywhere in the schema.

## 2. Row-Level Security (RLS) — the wall for user-key access
Every tenant table has RLS enabled with policies of the form
`USING (public.is_member_of(organization_id))`, where `is_member_of` checks the
`organization_members` table (user → org → role). **Anything using a user or anon
key — i.e. the entire dashboard — is hard-walled by the database.** A bug in the
frontend cannot return another tenant's rows; Postgres refuses them.

## 3. Service-role access — deliberate, and scoped
The gateway connects with the Supabase **service-role key, which intentionally
bypasses Row-Level Security** because it executes trusted backend workflows
(inbound webhooks for all tenants, encryption, cross-cutting jobs) and is not a
logged-in user. To maintain tenant isolation on this path:

- **All service-layer data access requires an organization context and scopes
  every query by `organization_id`.** The `SupabaseBusinessStore` methods take
  `organizationId` and scope internally; ad-hoc gateway queries go through the
  `tenantDb(orgId)` repository, which auto-injects `organization_id` on reads,
  updates, deletes and inserts — so business logic never passes it by hand,
  removing the "forgot the org filter" class of bug.
- **Tenant context is established once, up front, and never re-derived.** Inbound
  WhatsApp: `resolveInbound()` maps `phone_number_id → organization_id` before any
  business logic. Operator API: `authoriseOperator()` resolves the caller's org
  from their session. Everything downstream uses that resolved `organizationId`.

## 4. Composite foreign keys — defense in depth (DB-enforced, even for service-role)
As an additional safeguard, **composite `(organization_id, id)` foreign keys**
enforce that related records cannot cross tenant boundaries **even if a coding
error occurs on the service-role path**. A `bookings` row can only reference a
`contacts` row in the *same* organization; a `messages` row only a `conversations`
row in the same org; and so on across ~29 parent→child relations. The database
rejects a cross-tenant write outright — verified with a live test:

```
insert into contact_notes (organization_id, contact_id, …)   -- org B, contact from org A
→ ERROR: violates foreign key constraint "contact_notes_contact_id_org_fkey"
```

> `payments.order_id` is intentionally **not** FK-constrained: it is polymorphic
> (an `orders` id for product sales, a `bookings` id for travel/cab/maid), so a
> single-target FK would reject legitimate booking payments. Its isolation is
> enforced by RLS + `organization_id` scoping like every other table.

## Secrets
Per-tenant secrets — WhatsApp access tokens, each merchant's Razorpay keys, and
customer phone numbers — are encrypted at rest (AES-256-GCM), with phone numbers
additionally blind-indexed for lookup. The encryption key lives outside the
database (see `DR-RUNBOOK.md`). For scale, graduate to envelope encryption / a
managed KMS.

## Integration boundary
External providers sit behind interfaces so the business layer is provider-
agnostic: `WhatsAppAdapter` (Meta / Twilio / Instagram), `RazorpayPaymentService`
(+ direct UPI), `EmailService` (Resend), `OcrService` (Gemini), `HubSpotService`,
`StripeBillingService`. Swapping or adding a provider (Cashfree, PayU) does not
touch business logic.

## Observability
Service-role mutations of note are written to `audit_events`
(org, actor, action, entity, details, timestamp); LLM spend to `llm_usage`;
failures to `error_events` with throttled ops alerts. A fuller per-operation
service-role audit trail (endpoint, table, rows affected) is a planned
enhancement.

## Isolation summary

| Access path | Isolation enforced by |
|---|---|
| Dashboard (user/anon key) | **Database — RLS** (`is_member_of`) |
| Gateway (service-role key) | **App — `tenantDb`/store scope by org** + **DB — composite FKs** |
| Related-record integrity | **Database — composite `(organization_id, id)` FKs** |
| Secrets | **AES-256-GCM at rest**, key held outside the DB |
