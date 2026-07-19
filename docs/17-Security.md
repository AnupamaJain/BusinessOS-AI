# Security & Compliance Specification

## 1. Tenant Security Controls
- **Row-Level Security (RLS)**: Enforced on all PostgreSQL tables using `auth.is_member_of(organization_id)` function.
- **Append-Only Auditing**: `audit_events` table protected against `UPDATE` and `DELETE` via database triggers `audit_events_no_update` and `audit_events_no_delete`.
- **RBAC Matrix**: Role-based access control checking `owner`, `manager`, `sales_agent`, and `support_agent`.

## 2. API & Data Security
- Encrypted secrets using HashiCorp Vault / Kubernetes Secrets.
- HTTPS TLS 1.3 in transit and AES-256 at rest.
- Webhook signature verification checking Meta HMAC SHA-256 signatures.
