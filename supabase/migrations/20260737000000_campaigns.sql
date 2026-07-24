-- Data-driven marketing: multi-channel campaigns (WhatsApp | Email) to a
-- segmented audience, with per-recipient tracking that powers REAL analytics
-- (delivered/read from WhatsApp status webhooks, open/click from email +
-- tracked-link redirects, conversion from lead attribution).

-- Saved audience definitions (reusable filters over leads/contacts).
create table if not exists public.segments (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name            text not null,
  filters         jsonb not null default '{}',
  created_at      timestamptz not null default now()
);
create index if not exists idx_segments_org on public.segments (organization_id, created_at desc);

create table if not exists public.campaigns (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name            text not null,
  channel         text not null check (channel in ('whatsapp','email')),
  status          text not null default 'draft' check (status in ('draft','sending','sent','failed')),
  audience        jsonb not null default '{}',   -- segment filter captured at send time
  template_key    text,                          -- whatsapp: approved template name
  email_subject   text,                          -- email channel
  email_html      text,                          -- email body (may contain {{name}}/{{url}})
  target_url      text,                          -- CTA link, wrapped per-recipient for CTR
  total           integer not null default 0,
  sent            integer not null default 0,
  failed          integer not null default 0,
  started_by      text,
  created_at      timestamptz not null default now(),
  sent_at         timestamptz,
  completed_at    timestamptz,
  -- Composite key so campaign_recipients can enforce tenant isolation at the DB.
  unique (organization_id, id)
);
create index if not exists idx_campaigns_org on public.campaigns (organization_id, created_at desc);

create table if not exists public.campaign_recipients (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations(id) on delete cascade,
  campaign_id         uuid not null,
  contact_id          uuid,               -- for conversion attribution + engagement
  channel             text not null,
  address             text not null,      -- phone (whatsapp) or email
  provider_message_id text,               -- maps status/webhook events back to this row
  status              text not null default 'queued',  -- queued|sent|delivered|read|opened|failed
  delivered_at        timestamptz,
  opened_at           timestamptz,        -- WhatsApp 'read' or email 'opened'
  clicked_at          timestamptz,
  click_count         integer not null default 0,
  converted_at        timestamptz,
  error               text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  -- DB-enforced tenant isolation: a recipient can only point at a campaign in
  -- the SAME org (composite FK — cross-tenant writes are impossible).
  foreign key (organization_id, campaign_id)
    references public.campaigns (organization_id, id) on delete cascade
);
create index if not exists idx_camp_rcpt_campaign on public.campaign_recipients (campaign_id);
create index if not exists idx_camp_rcpt_provider on public.campaign_recipients (provider_message_id);
create index if not exists idx_camp_rcpt_contact  on public.campaign_recipients (organization_id, contact_id);

-- RLS: members read their org's rows; only the service role writes.
alter table public.segments enable row level security;
alter table public.campaigns enable row level security;
alter table public.campaign_recipients enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where policyname = 'segments_select') then
    create policy segments_select on public.segments for select using (public.is_member_of(organization_id));
  end if;
  if not exists (select 1 from pg_policies where policyname = 'campaigns_select') then
    create policy campaigns_select on public.campaigns for select using (public.is_member_of(organization_id));
  end if;
  if not exists (select 1 from pg_policies where policyname = 'campaign_recipients_select') then
    create policy campaign_recipients_select on public.campaign_recipients for select using (public.is_member_of(organization_id));
  end if;
end $$;
