-- Business Brain CRM data layer: per-customer AI memory + operator notes, plus
-- contact tags / preferred language / last-seen. All additive; safe to run once.

-- ── Contact enrichment ────────────────────────────────────────────────
alter table public.contacts
  add column if not exists tags text[] not null default '{}';
alter table public.contacts
  add column if not exists preferred_language text;
alter table public.contacts
  add column if not exists last_seen_at timestamptz;

-- ── Per-customer memory + operator notes ──────────────────────────────
-- kind='memory' rows are AI-written durable facts about a customer;
-- kind='note' rows are free-form operator notes from the dashboard.
create table if not exists public.contact_notes (
  id              uuid        primary key default gen_random_uuid(),
  organization_id uuid        not null references public.organizations(id) on delete cascade,
  contact_id      uuid        not null references public.contacts(id) on delete cascade,
  kind            text        not null default 'note' check (kind in ('memory','note')),
  body            text        not null,
  created_by      uuid,
  created_at      timestamptz not null default now()
);

create index if not exists idx_contact_notes_org_contact
  on public.contact_notes (organization_id, contact_id, created_at desc);

alter table public.contact_notes enable row level security;

-- The dashboard (auth key) reads AND writes notes directly, so members need
-- select/insert/update/delete. Idempotent DO-block matching ops_hardening.
do $$ begin
  if not exists (select 1 from pg_policies where policyname = 'contact_notes_select') then
    create policy contact_notes_select on public.contact_notes
      for select using (public.is_member_of(organization_id));
  end if;
  if not exists (select 1 from pg_policies where policyname = 'contact_notes_insert') then
    create policy contact_notes_insert on public.contact_notes
      for insert with check (public.is_member_of(organization_id));
  end if;
  if not exists (select 1 from pg_policies where policyname = 'contact_notes_update') then
    create policy contact_notes_update on public.contact_notes
      for update using (public.is_member_of(organization_id))
      with check (public.is_member_of(organization_id));
  end if;
  if not exists (select 1 from pg_policies where policyname = 'contact_notes_delete') then
    create policy contact_notes_delete on public.contact_notes
      for delete using (public.is_member_of(organization_id));
  end if;
end $$;
