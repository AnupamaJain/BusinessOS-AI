# Backup & Disaster-Recovery Runbook

_Last reviewed: 2026-07-21_

This is the operational answer to "what happens if the database, a deploy, or a
tenant's data is lost or corrupted." SaarthiOne is stateless at the compute
tier (Vercel serverless) and stateful only in Supabase (Postgres) + object
storage, so DR centres on Postgres.

## 1. What holds state

| Store | What | Recovery source |
|-------|------|-----------------|
| Supabase Postgres | orgs, contacts, conversations, messages, leads, bookings, quotes, catalog, knowledge, `whatsapp_connections` (encrypted tokens), `llm_usage`, `error_events` | Supabase backups / PITR |
| Supabase Auth | operator/owner logins, memberships | Included in the Postgres backup (`auth` schema) |
| Vercel | the two deployments (gateway + web) — **no durable state** | Re-deploy from git (`main`) |
| Env/secrets | API keys, `ENCRYPTION_KEY`, DB password | `.credentials.local.md` (git-ignored) + Vercel env store |

> The `ENCRYPTION_KEY` is **not** in the database. Losing it makes every
> encrypted column (WhatsApp tokens, contact `phone_enc`) unrecoverable. Store a
> copy in a password manager / secret vault, separate from the DB backup.

## 2. Backups (must be enabled)

Supabase provides two mechanisms — enable both on the project (`vhszjxrqgmfiiooshjqf`):

1. **Daily automated backups** — retained per plan (7 days on Pro). Dashboard →
   Database → Backups. Free tier does **not** include automated backups, so a
   paid plan is a production prerequisite.
2. **Point-in-Time Recovery (PITR)** — add-on; lets you restore to any second in
   the retention window. Strongly recommended before onboarding paying tenants,
   because it bounds data loss (RPO) to seconds instead of ~24h.

**Off-platform copy (defence against account loss):** run a weekly logical dump
to cold storage you control:

```bash
# From an operator machine (psql/pg_dump installed), using the pooler URL:
pg_dump "postgresql://postgres.vhszjxrqgmfiiooshjqf:<DB_PASSWORD>@aws-1-ap-south-1.pooler.supabase.com:5432/postgres" \
  --no-owner --format=custom --file "saarthione-$(date +%F).dump"
# Encrypt and upload to your own bucket (S3/GCS) with lifecycle retention.
```

Automate this as a scheduled job (GitHub Actions cron, or a small VM cron) and
alert on failure. Verify a restore into a scratch project **quarterly** — an
untested backup is not a backup.

## 3. Recovery playbooks

### 3a. Bad data / accidental deletion (single tenant or table)
1. Identify the timestamp just before the incident.
2. PITR-restore into a **new** Supabase project (never overwrite prod blindly).
3. Extract only the affected rows (e.g. one org's `contacts`) and re-insert into
   prod. Org-scoped tables all carry `organization_id`, so a tenant's data is a
   clean `WHERE organization_id = ...` slice.

### 3b. Full database loss
1. Restore the latest backup / PITR into a new project.
2. Point the gateway + web at the new project: update `NEXT_PUBLIC_SUPABASE_URL`,
   `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` in both Vercel
   projects, plus the same `ENCRYPTION_KEY` as before (or encrypted columns won't
   decrypt).
3. Re-run pending migrations if the restore predates them: `supabase db push`.
4. Redeploy both apps (they are rebuildable from `main`).

### 3c. Bad deploy
- Gateway/web are immutable Vercel deployments. Roll back by re-aliasing the
  previous good deployment: `vercel alias set <previous-deploy-url> saarthione-api.vercel.app`
  (and `saarthione.vercel.app` for web). No data involved.

### 3d. Leaked / rotated secrets
- Rotate the Supabase service key and DB password in the dashboard, update Vercel
  env + `.credentials.local.md`, redeploy.
- Rotate `ENCRYPTION_KEY` only with a re-encryption migration (decrypt with old,
  re-encrypt with new) — a bare swap orphans existing ciphertext.

## 4. Targets

| Metric | Target | Basis |
|--------|--------|-------|
| RPO (max data loss) | ≤ 5 min | PITR (once enabled); else ≤ 24h with daily backups |
| RTO (time to restore) | ≤ 1 h | restore new project + repoint env + redeploy |

## 5. Open items before "paying-tenants" grade
- [ ] Confirm the Supabase plan includes automated backups + enable PITR.
- [ ] Stand up the weekly off-platform encrypted dump + failure alert.
- [ ] Store `ENCRYPTION_KEY` in a vault separate from DB backups.
- [ ] Do one quarterly restore drill and record the measured RTO here.
