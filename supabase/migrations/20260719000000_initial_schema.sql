-- ============================================================================
-- WhatsApp AI SMB Platform - Initial Schema Migration
-- Creates all 16 tenant-bound tables, RLS policies, indexes, and triggers.
-- ============================================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "vector";

-- ============================================================================
-- 1. organizations
-- ============================================================================
CREATE TABLE organizations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL CHECK (char_length(name) <= 255),
  slug TEXT NOT NULL UNIQUE CHECK (char_length(slug) <= 100),
  vertical TEXT CHECK (char_length(vertical) <= 100),
  settings JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- 2. organization_members
-- ============================================================================
CREATE TABLE organization_members (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,  -- references auth.users
  role TEXT NOT NULL CHECK (role IN ('owner', 'manager', 'sales_agent', 'support_agent')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, user_id)
);
CREATE INDEX idx_org_members_user ON organization_members(user_id);
CREATE INDEX idx_org_members_org ON organization_members(organization_id);

-- ============================================================================
-- 3. contacts
-- ============================================================================
CREATE TABLE contacts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  phone_number TEXT NOT NULL CHECK (char_length(phone_number) BETWEEN 7 AND 20),
  name TEXT CHECK (char_length(name) <= 255),
  email TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, phone_number)
);
CREATE INDEX idx_contacts_org ON contacts(organization_id);
CREATE INDEX idx_contacts_phone ON contacts(phone_number);

-- ============================================================================
-- 4. consent_records
-- ============================================================================
CREATE TABLE consent_records (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  consent_type TEXT NOT NULL CHECK (consent_type IN ('marketing', 'transactional', 'support')),
  action TEXT NOT NULL CHECK (action IN ('opt_in', 'opt_out')),
  source TEXT NOT NULL CHECK (char_length(source) <= 255),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_consent_org ON consent_records(organization_id);
CREATE INDEX idx_consent_contact ON consent_records(contact_id);

-- ============================================================================
-- 5. conversations
-- ============================================================================
CREATE TABLE conversations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  channel TEXT NOT NULL DEFAULT 'whatsapp' CHECK (char_length(channel) <= 50),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'waiting_for_human', 'resolved', 'closed')),
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_conversations_org ON conversations(organization_id);
CREATE INDEX idx_conversations_contact ON conversations(contact_id);
CREATE INDEX idx_conversations_status ON conversations(status);

-- ============================================================================
-- 6. messages
-- ============================================================================
CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  message_type TEXT NOT NULL CHECK (message_type IN ('text', 'image', 'document', 'template', 'interactive', 'reaction', 'system')),
  content TEXT NOT NULL,
  provider_message_id TEXT CHECK (char_length(provider_message_id) <= 255),
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_messages_org ON messages(organization_id);
CREATE INDEX idx_messages_conversation ON messages(conversation_id);
CREATE INDEX idx_messages_provider_id ON messages(provider_message_id);

-- ============================================================================
-- 7. leads
-- ============================================================================
CREATE TABLE leads (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES conversations(id),
  stage TEXT NOT NULL DEFAULT 'new' CHECK (stage IN ('new', 'contacted', 'qualified', 'proposal', 'negotiation', 'won', 'lost', 'disqualified')),
  service_interest TEXT NOT NULL CHECK (char_length(service_interest) <= 500),
  budget_range TEXT CHECK (char_length(budget_range) <= 100),
  purchase_timeline TEXT CHECK (char_length(purchase_timeline) <= 100),
  qualification_summary TEXT CHECK (char_length(qualification_summary) <= 2000),
  score INTEGER CHECK (score >= 0 AND score <= 100),
  owner_id UUID,
  idempotency_key TEXT NOT NULL CHECK (char_length(idempotency_key) <= 255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, idempotency_key)
);
CREATE INDEX idx_leads_org ON leads(organization_id);
CREATE INDEX idx_leads_contact ON leads(contact_id);
CREATE INDEX idx_leads_stage ON leads(stage);

-- ============================================================================
-- 8. handoffs
-- ============================================================================
CREATE TABLE handoffs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  reason TEXT NOT NULL CHECK (reason IN ('customer_request', 'complaint_or_refund', 'payment_issue', 'legal_or_medical', 'low_confidence', 'repeated_failure', 'integration_error', 'unsafe_request')),
  priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'claimed', 'resolved', 'expired')),
  summary TEXT NOT NULL CHECK (char_length(summary) <= 2000),
  claimed_by UUID,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_handoffs_org ON handoffs(organization_id);
CREATE INDEX idx_handoffs_conversation ON handoffs(conversation_id);
CREATE INDEX idx_handoffs_status ON handoffs(status);

-- ============================================================================
-- 9. lead_activities
-- ============================================================================
CREATE TABLE lead_activities (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (char_length(action) <= 255),
  details JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_lead_activities_org ON lead_activities(organization_id);
CREATE INDEX idx_lead_activities_lead ON lead_activities(lead_id);

-- ============================================================================
-- 10. automation_runs
-- ============================================================================
CREATE TABLE automation_runs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES conversations(id),
  campaign_type TEXT NOT NULL CHECK (campaign_type IN ('qualified_lead_followup', 'appointment_reminder', 'reorder_reminder', 'abandoned_enquiry')),
  template_key TEXT NOT NULL CHECK (char_length(template_key) <= 255),
  idempotency_key TEXT NOT NULL CHECK (char_length(idempotency_key) <= 255),
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'eligible', 'sent', 'skipped', 'failed', 'cancelled')),
  scheduled_for TIMESTAMPTZ NOT NULL,
  sent_at TIMESTAMPTZ,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, idempotency_key)
);
CREATE INDEX idx_automation_runs_org ON automation_runs(organization_id);
CREATE INDEX idx_automation_runs_scheduled ON automation_runs(scheduled_for);
CREATE INDEX idx_automation_runs_status ON automation_runs(status);

-- ============================================================================
-- 11. audit_events (append-only)
-- ============================================================================
CREATE TABLE audit_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (char_length(action) <= 100),
  entity_type TEXT NOT NULL CHECK (char_length(entity_type) <= 100),
  entity_id UUID,
  actor_id UUID,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('user', 'system', 'agent')),
  details JSONB DEFAULT '{}',
  trace_id TEXT CHECK (char_length(trace_id) <= 255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_events_org ON audit_events(organization_id);
CREATE INDEX idx_audit_events_entity ON audit_events(entity_type, entity_id);
CREATE INDEX idx_audit_events_created ON audit_events(created_at);

-- ============================================================================
-- 12. integration_connections
-- ============================================================================
CREATE TABLE integration_connections (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (char_length(provider) <= 100),
  status TEXT NOT NULL DEFAULT 'inactive' CHECK (status IN ('active', 'inactive', 'error')),
  config JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_integrations_org ON integration_connections(organization_id);

-- ============================================================================
-- 13. knowledge_documents
-- ============================================================================
CREATE TABLE knowledge_documents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  title TEXT NOT NULL CHECK (char_length(title) <= 500),
  source_path TEXT NOT NULL CHECK (char_length(source_path) <= 1000),
  content_hash TEXT CHECK (char_length(content_hash) <= 64),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'processing', 'error', 'archived')),
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_knowledge_docs_org ON knowledge_documents(organization_id);

-- ============================================================================
-- 14. knowledge_chunks
-- ============================================================================
CREATE TABLE knowledge_chunks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  document_id UUID NOT NULL REFERENCES knowledge_documents(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL CHECK (chunk_index >= 0),
  content TEXT NOT NULL,
  metadata JSONB DEFAULT '{}',
  embedding vector(1536),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_knowledge_chunks_org ON knowledge_chunks(organization_id);
CREATE INDEX idx_knowledge_chunks_doc ON knowledge_chunks(document_id);

-- ============================================================================
-- 15. message_templates
-- ============================================================================
CREATE TABLE message_templates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  template_key TEXT NOT NULL CHECK (char_length(template_key) <= 255),
  name TEXT NOT NULL CHECK (char_length(name) <= 255),
  content TEXT NOT NULL,
  language TEXT NOT NULL DEFAULT 'en' CHECK (char_length(language) <= 10),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('approved', 'pending', 'rejected')),
  category TEXT NOT NULL CHECK (char_length(category) <= 100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, template_key)
);
CREATE INDEX idx_message_templates_org ON message_templates(organization_id);

-- ============================================================================
-- 16. outbound_message_sends
-- ============================================================================
CREATE TABLE outbound_message_sends (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES conversations(id),
  template_key TEXT NOT NULL CHECK (char_length(template_key) <= 255),
  content TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sent', 'delivered', 'failed')),
  provider_message_id TEXT CHECK (char_length(provider_message_id) <= 255),
  idempotency_key TEXT NOT NULL CHECK (char_length(idempotency_key) <= 255),
  sent_at TIMESTAMPTZ,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, idempotency_key)
);
CREATE INDEX idx_outbound_sends_org ON outbound_message_sends(organization_id);
CREATE INDEX idx_outbound_sends_status ON outbound_message_sends(status);

-- ============================================================================
-- updated_at trigger function
-- ============================================================================
CREATE OR REPLACE FUNCTION trigger_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply updated_at triggers to tables that have updated_at
DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'organizations', 'contacts', 'conversations', 'leads',
    'handoffs', 'automation_runs', 'integration_connections',
    'knowledge_documents', 'message_templates', 'outbound_message_sends'
  ]
  LOOP
    EXECUTE format(
      'CREATE TRIGGER set_updated_at BEFORE UPDATE ON %I
       FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at()',
      tbl
    );
  END LOOP;
END;
$$;

-- ============================================================================
-- Audit events: prevent UPDATE and DELETE (append-only)
-- ============================================================================
CREATE OR REPLACE FUNCTION prevent_audit_modification()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Audit events are append-only. UPDATE and DELETE are not permitted.';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_events_no_update
  BEFORE UPDATE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION prevent_audit_modification();

CREATE TRIGGER audit_events_no_delete
  BEFORE DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION prevent_audit_modification();

-- ============================================================================
-- Row Level Security (RLS)
-- ============================================================================

-- Enable RLS on all tenant-bound tables
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE consent_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE handoffs ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE automation_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE integration_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE outbound_message_sends ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- RLS Policies
-- Policy pattern: user can access rows where organization_id matches
-- an organization they belong to via organization_members.
-- ============================================================================

-- organizations: members can see their own organizations
CREATE POLICY org_member_select ON organizations
  FOR SELECT USING (
    id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = auth.uid()
    )
  );

-- organization_members: members can see other members of their organizations
CREATE POLICY org_members_select ON organization_members
  FOR SELECT USING (
    organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = auth.uid()
    )
  );

-- For all other tenant-bound tables, create SELECT/INSERT/UPDATE policies
-- scoped to the user's organization memberships.

-- Helper function to check membership
CREATE OR REPLACE FUNCTION auth.is_member_of(org_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM organization_members
    WHERE organization_id = org_id AND user_id = auth.uid()
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- Macro to create standard RLS policies for tenant-bound tables
DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'contacts', 'consent_records', 'conversations', 'messages',
    'leads', 'handoffs', 'lead_activities', 'automation_runs',
    'integration_connections', 'knowledge_documents', 'knowledge_chunks',
    'message_templates', 'outbound_message_sends'
  ]
  LOOP
    -- SELECT policy
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR SELECT USING (auth.is_member_of(organization_id))',
      tbl || '_select', tbl
    );

    -- INSERT policy
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR INSERT WITH CHECK (auth.is_member_of(organization_id))',
      tbl || '_insert', tbl
    );

    -- UPDATE policy
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR UPDATE USING (auth.is_member_of(organization_id))',
      tbl || '_update', tbl
    );
  END LOOP;
END;
$$;

-- Audit events: SELECT only (no update/delete allowed by trigger)
CREATE POLICY audit_events_select ON audit_events
  FOR SELECT USING (auth.is_member_of(organization_id));

CREATE POLICY audit_events_insert ON audit_events
  FOR INSERT WITH CHECK (auth.is_member_of(organization_id));
