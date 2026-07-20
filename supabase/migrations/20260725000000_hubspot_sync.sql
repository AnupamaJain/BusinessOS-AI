-- HubSpot two-way CRM sync.
-- Store the HubSpot object ids on our rows so inbound webhooks (property changes
-- in HubSpot) can be mapped back to the SaarthiOne contact/lead they belong to.

alter table public.contacts
  add column if not exists hubspot_contact_id text;

alter table public.leads
  add column if not exists hubspot_deal_id text;

-- Fast lookup when a HubSpot webhook arrives keyed by the HubSpot object id.
create index if not exists idx_contacts_hubspot_contact_id
  on public.contacts (hubspot_contact_id)
  where hubspot_contact_id is not null;

create index if not exists idx_leads_hubspot_deal_id
  on public.leads (hubspot_deal_id)
  where hubspot_deal_id is not null;
