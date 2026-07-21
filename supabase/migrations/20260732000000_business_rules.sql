-- Layer 5 (business rules) + Layer 1 (choose AI team). Per-merchant structured
-- configuration the AI consults before acting, plus which teammates are active.
alter table public.organizations
  add column if not exists business_rules jsonb not null default '{}',
  add column if not exists enabled_agents text[] not null default '{sales,support,booking,operations}';
