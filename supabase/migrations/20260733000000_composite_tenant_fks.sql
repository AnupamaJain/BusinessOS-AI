-- Defense-in-depth multi-tenancy: composite (organization_id, id) foreign keys.
-- A child row (booking, message, note, payment, …) now cannot reference a parent
-- (contact, conversation, …) in a DIFFERENT organization — the database rejects it,
-- even on the service-role path that bypasses RLS. Verified: 0 cross-tenant rows.

-- 1) Composite unique keys on parents (targets for the composite FKs).
alter table public.bookings add constraint bookings_org_id_key unique (organization_id, id);
alter table public.contacts add constraint contacts_org_id_key unique (organization_id, id);
alter table public.conversations add constraint conversations_org_id_key unique (organization_id, id);
alter table public.destinations add constraint destinations_org_id_key unique (organization_id, id);
alter table public.knowledge_documents add constraint knowledge_documents_org_id_key unique (organization_id, id);
alter table public.leads add constraint leads_org_id_key unique (organization_id, id);
alter table public.orders add constraint orders_org_id_key unique (organization_id, id);
alter table public.packages add constraint packages_org_id_key unique (organization_id, id);
alter table public.payments add constraint payments_org_id_key unique (organization_id, id);
alter table public.product_variants add constraint product_variants_org_id_key unique (organization_id, id);
alter table public.products add constraint products_org_id_key unique (organization_id, id);
alter table public.quotes add constraint quotes_org_id_key unique (organization_id, id);

-- 2) Recreate each FK as composite on (organization_id, <ref>).
alter table public.automation_runs drop constraint automation_runs_contact_id_fkey;
alter table public.automation_runs add constraint automation_runs_contact_id_org_fkey foreign key (organization_id, contact_id) references public.contacts (organization_id, id) on delete cascade;
alter table public.automation_runs drop constraint automation_runs_conversation_id_fkey;
alter table public.automation_runs add constraint automation_runs_conversation_id_org_fkey foreign key (organization_id, conversation_id) references public.conversations (organization_id, id);
alter table public.bookings drop constraint bookings_contact_id_fkey;
alter table public.bookings add constraint bookings_contact_id_org_fkey foreign key (organization_id, contact_id) references public.contacts (organization_id, id) on delete cascade;
alter table public.bookings drop constraint bookings_package_id_fkey;
alter table public.bookings add constraint bookings_package_id_org_fkey foreign key (organization_id, package_id) references public.packages (organization_id, id);
alter table public.consent_records drop constraint consent_records_contact_id_fkey;
alter table public.consent_records add constraint consent_records_contact_id_org_fkey foreign key (organization_id, contact_id) references public.contacts (organization_id, id) on delete cascade;
alter table public.contact_notes drop constraint contact_notes_contact_id_fkey;
alter table public.contact_notes add constraint contact_notes_contact_id_org_fkey foreign key (organization_id, contact_id) references public.contacts (organization_id, id) on delete cascade;
alter table public.conversations drop constraint conversations_contact_id_fkey;
alter table public.conversations add constraint conversations_contact_id_org_fkey foreign key (organization_id, contact_id) references public.contacts (organization_id, id) on delete cascade;
alter table public.handoffs drop constraint handoffs_contact_id_fkey;
alter table public.handoffs add constraint handoffs_contact_id_org_fkey foreign key (organization_id, contact_id) references public.contacts (organization_id, id) on delete cascade;
alter table public.handoffs drop constraint handoffs_conversation_id_fkey;
alter table public.handoffs add constraint handoffs_conversation_id_org_fkey foreign key (organization_id, conversation_id) references public.conversations (organization_id, id) on delete cascade;
alter table public.hotels drop constraint hotels_destination_id_fkey;
alter table public.hotels add constraint hotels_destination_id_org_fkey foreign key (organization_id, destination_id) references public.destinations (organization_id, id) on delete set null (destination_id);
alter table public.invoices drop constraint invoices_order_id_fkey;
alter table public.invoices add constraint invoices_order_id_org_fkey foreign key (organization_id, order_id) references public.orders (organization_id, id) on delete cascade;
alter table public.itineraries drop constraint itineraries_booking_id_fkey;
alter table public.itineraries add constraint itineraries_booking_id_org_fkey foreign key (organization_id, booking_id) references public.bookings (organization_id, id) on delete cascade;
alter table public.itineraries drop constraint itineraries_quote_id_fkey;
alter table public.itineraries add constraint itineraries_quote_id_org_fkey foreign key (organization_id, quote_id) references public.quotes (organization_id, id) on delete set null (quote_id);
alter table public.knowledge_chunks drop constraint knowledge_chunks_document_id_fkey;
alter table public.knowledge_chunks add constraint knowledge_chunks_document_id_org_fkey foreign key (organization_id, document_id) references public.knowledge_documents (organization_id, id) on delete cascade;
alter table public.lead_activities drop constraint lead_activities_lead_id_fkey;
alter table public.lead_activities add constraint lead_activities_lead_id_org_fkey foreign key (organization_id, lead_id) references public.leads (organization_id, id) on delete cascade;
alter table public.leads drop constraint leads_contact_id_fkey;
alter table public.leads add constraint leads_contact_id_org_fkey foreign key (organization_id, contact_id) references public.contacts (organization_id, id) on delete cascade;
alter table public.leads drop constraint leads_conversation_id_fkey;
alter table public.leads add constraint leads_conversation_id_org_fkey foreign key (organization_id, conversation_id) references public.conversations (organization_id, id);
alter table public.messages drop constraint messages_conversation_id_fkey;
alter table public.messages add constraint messages_conversation_id_org_fkey foreign key (organization_id, conversation_id) references public.conversations (organization_id, id) on delete cascade;
alter table public.order_items drop constraint order_items_order_id_fkey;
alter table public.order_items add constraint order_items_order_id_org_fkey foreign key (organization_id, order_id) references public.orders (organization_id, id) on delete cascade;
alter table public.order_items drop constraint order_items_product_id_fkey;
alter table public.order_items add constraint order_items_product_id_org_fkey foreign key (organization_id, product_id) references public.products (organization_id, id) on delete set null (product_id);
alter table public.order_items drop constraint order_items_variant_id_fkey;
alter table public.order_items add constraint order_items_variant_id_org_fkey foreign key (organization_id, variant_id) references public.product_variants (organization_id, id) on delete set null (variant_id);
alter table public.orders drop constraint orders_contact_id_fkey;
alter table public.orders add constraint orders_contact_id_org_fkey foreign key (organization_id, contact_id) references public.contacts (organization_id, id) on delete cascade;
alter table public.outbound_message_sends drop constraint outbound_message_sends_contact_id_fkey;
alter table public.outbound_message_sends add constraint outbound_message_sends_contact_id_org_fkey foreign key (organization_id, contact_id) references public.contacts (organization_id, id) on delete cascade;
alter table public.outbound_message_sends drop constraint outbound_message_sends_conversation_id_fkey;
alter table public.outbound_message_sends add constraint outbound_message_sends_conversation_id_org_fkey foreign key (organization_id, conversation_id) references public.conversations (organization_id, id);
alter table public.packages drop constraint packages_destination_id_fkey;
alter table public.packages add constraint packages_destination_id_org_fkey foreign key (organization_id, destination_id) references public.destinations (organization_id, id) on delete set null (destination_id);
alter table public.product_variants drop constraint product_variants_product_id_fkey;
alter table public.product_variants add constraint product_variants_product_id_org_fkey foreign key (organization_id, product_id) references public.products (organization_id, id) on delete cascade;
alter table public.quotes drop constraint quotes_contact_id_fkey;
alter table public.quotes add constraint quotes_contact_id_org_fkey foreign key (organization_id, contact_id) references public.contacts (organization_id, id) on delete cascade;
alter table public.quotes drop constraint quotes_package_id_fkey;
alter table public.quotes add constraint quotes_package_id_org_fkey foreign key (organization_id, package_id) references public.packages (organization_id, id);
alter table public.refunds drop constraint refunds_payment_id_fkey;
alter table public.refunds add constraint refunds_payment_id_org_fkey foreign key (organization_id, payment_id) references public.payments (organization_id, id) on delete cascade;

-- 3) payments.order_id is polymorphic (an orders id OR a bookings id) — drop the
-- single-target FK (it would reject booking payments). Isolation for payments
-- stays enforced by RLS + organization_id scoping.
alter table public.payments drop constraint if exists payments_order_id_fkey;

