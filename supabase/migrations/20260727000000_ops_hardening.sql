-- Production hardening: cross-instance rate limiting, real team invites,
-- and alert de-duplication. All additive; safe to run once.

-- ── Cross-instance rate limiting ──────────────────────────────────────
-- A shared fixed-window counter so a burst spread across serverless
-- instances is still caught (the in-memory Map only saw one instance).
create table if not exists public.rate_limit_hits (
  bucket_key   text        not null,
  window_start timestamptz not null,
  hits         integer     not null default 0,
  primary key (bucket_key, window_start)
);

-- Atomic "consume one token" for the current fixed window. Returns true when
-- the caller is UNDER the limit (allowed), false when the limit is exceeded.
create or replace function public.check_rate_limit(
  p_key text, p_max integer, p_window_seconds integer
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_window timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  v_hits integer;
begin
  insert into public.rate_limit_hits (bucket_key, window_start, hits)
  values (p_key, v_window, 1)
  on conflict (bucket_key, window_start)
  do update set hits = public.rate_limit_hits.hits + 1
  returning hits into v_hits;
  return v_hits <= p_max;
end;
$$;

-- Housekeeping: drop windows older than a day (called opportunistically).
create or replace function public.prune_rate_limit_hits() returns void
language sql security definer set search_path = public as $$
  delete from public.rate_limit_hits where window_start < now() - interval '1 day';
$$;

-- ── Alert de-duplication ──────────────────────────────────────────────
-- One row per (alert_key, hour) so N instances hitting the same error only
-- send a single email per throttle window.
create table if not exists public.alert_log (
  alert_key  text        not null,
  sent_at    timestamptz not null default now(),
  window_key text        not null,
  primary key (alert_key, window_key)
);

-- Claims the right to send an alert for this key+window; true = you send it.
create or replace function public.claim_alert(p_key text, p_window_key text)
returns boolean
language plpgsql security definer set search_path = public as $$
begin
  insert into public.alert_log (alert_key, window_key) values (p_key, p_window_key);
  return true;
exception when unique_violation then
  return false;
end;
$$;

-- ── Real team invites ─────────────────────────────────────────────────
create table if not exists public.team_invites (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  email           text not null,
  role            text not null default 'operator' check (role in ('operator','admin','owner')),
  status          text not null default 'pending' check (status in ('pending','accepted','revoked')),
  token           text not null unique,
  invited_by      uuid,
  created_at      timestamptz not null default now(),
  accepted_at     timestamptz,
  unique (organization_id, email)
);
create index if not exists idx_team_invites_org on public.team_invites (organization_id);
create index if not exists idx_team_invites_token on public.team_invites (token);

alter table public.team_invites enable row level security;

-- Members of the org can read/manage their org's invites; the gateway uses the
-- service role for writes so no INSERT policy is exposed to anon/auth.
do $$ begin
  if not exists (select 1 from pg_policies where policyname = 'team_invites_select') then
    create policy team_invites_select on public.team_invites
      for select using (public.is_member_of(organization_id));
  end if;
  if not exists (select 1 from pg_policies where policyname = 'team_invites_update') then
    create policy team_invites_update on public.team_invites
      for update using (public.is_member_of(organization_id));
  end if;
end $$;
