-- Per-write audit trail for privileged / service-role operations (the RLS-
-- bypassing path). Records who did what to which resource, org-scoped.
create table if not exists public.service_audit_log (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  actor           text not null,   -- 'user:<id>', 'admin:<email>', 'agent', 'system', 'merchant-whatsapp'
  action          text not null,   -- e.g. 'merchant.status', 'integration.connect', 'booking.confirm'
  resource        text,            -- table / entity
  resource_id     text,
  operation       text,            -- insert | update | delete
  details         jsonb not null default '{}',
  created_at      timestamptz not null default now()
);
create index if not exists idx_service_audit_org on public.service_audit_log (organization_id, created_at desc);

alter table public.service_audit_log enable row level security;

-- Members can read their org's audit trail; only the service role writes it.
do $$ begin
  if not exists (select 1 from pg_policies where policyname = 'service_audit_log_select') then
    create policy service_audit_log_select on public.service_audit_log
      for select using (public.is_member_of(organization_id));
  end if;
end $$;
