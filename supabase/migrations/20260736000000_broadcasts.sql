-- Broadcast campaign runs: one row per "message this Google Sheet of contacts"
-- job. Recipient-level outcomes stay in message logs / the Sheet report tab;
-- this table is the run summary the dashboard lists and the audit trail links.
create table if not exists public.broadcasts (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  template_key    text not null,          -- approved WhatsApp template name
  source          text,                   -- e.g. 'google_sheets:Contacts'
  status          text not null default 'running',  -- running | completed | failed
  total           integer not null default 0,
  sent            integer not null default 0,
  failed          integer not null default 0,
  started_by      text,                   -- 'user:<id>' who triggered it
  errors          jsonb not null default '[]',       -- [{phone, error}]
  created_at      timestamptz not null default now(),
  completed_at    timestamptz
);
create index if not exists idx_broadcasts_org on public.broadcasts (organization_id, created_at desc);

alter table public.broadcasts enable row level security;

-- Members read their org's broadcast history; only the service role writes it.
do $$ begin
  if not exists (select 1 from pg_policies where policyname = 'broadcasts_select') then
    create policy broadcasts_select on public.broadcasts
      for select using (public.is_member_of(organization_id));
  end if;
end $$;
