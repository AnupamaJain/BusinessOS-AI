-- ============================================================================
-- Seed Data: GlowRoot Skincare (Demo Organization)
-- ============================================================================

-- Demo organization
INSERT INTO organizations (id, name, slug, vertical, settings)
VALUES (
  '11111111-1111-1111-1111-111111111111',
  'GlowRoot Skincare',
  'glowroot-skincare',
  'd2c-skincare',
  '{"timezone": "Asia/Kolkata", "business_hours": {"start": "09:00", "end": "21:00"}}'
);

-- Demo owner user (references a Supabase auth.users id — placeholder)
INSERT INTO organization_members (id, organization_id, user_id, role)
VALUES (
  '22222222-2222-2222-2222-222222222222',
  '11111111-1111-1111-1111-111111111111',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'owner'
);

-- Demo sales agent
INSERT INTO organization_members (id, organization_id, user_id, role)
VALUES (
  '22222222-2222-2222-2222-222222222233',
  '11111111-1111-1111-1111-111111111111',
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  'sales_agent'
);

-- Demo contact
INSERT INTO contacts (id, organization_id, phone_number, name, email)
VALUES (
  '33333333-3333-3333-3333-333333333333',
  '11111111-1111-1111-1111-111111111111',
  '+919876543210',
  'Priya Sharma',
  'priya@example.com'
);

-- Consent opt-in for marketing
INSERT INTO consent_records (id, organization_id, contact_id, consent_type, action, source)
VALUES (
  '44444444-4444-4444-4444-444444444444',
  '11111111-1111-1111-1111-111111111111',
  '33333333-3333-3333-3333-333333333333',
  'marketing',
  'opt_in',
  'whatsapp_first_message'
);

-- Consent opt-in for transactional
INSERT INTO consent_records (id, organization_id, contact_id, consent_type, action, source)
VALUES (
  '44444444-4444-4444-4444-444444444455',
  '11111111-1111-1111-1111-111111111111',
  '33333333-3333-3333-3333-333333333333',
  'transactional',
  'opt_in',
  'whatsapp_first_message'
);

-- Demo conversation
INSERT INTO conversations (id, organization_id, contact_id, channel, status)
VALUES (
  '55555555-5555-5555-5555-555555555555',
  '11111111-1111-1111-1111-111111111111',
  '33333333-3333-3333-3333-333333333333',
  'whatsapp',
  'active'
);

-- Knowledge documents
INSERT INTO knowledge_documents (id, organization_id, title, source_path, status)
VALUES
  ('66666666-6666-6666-6666-666666666601', '11111111-1111-1111-1111-111111111111', 'Products Catalog', 'knowledge-base/d2c-skincare/products.md', 'active'),
  ('66666666-6666-6666-6666-666666666602', '11111111-1111-1111-1111-111111111111', 'Shipping Policy', 'knowledge-base/d2c-skincare/shipping-policy.md', 'active'),
  ('66666666-6666-6666-6666-666666666603', '11111111-1111-1111-1111-111111111111', 'Returns Policy', 'knowledge-base/d2c-skincare/returns-policy.md', 'active'),
  ('66666666-6666-6666-6666-666666666604', '11111111-1111-1111-1111-111111111111', 'Safety Policy', 'knowledge-base/d2c-skincare/safety-policy.md', 'active'),
  ('66666666-6666-6666-6666-666666666605', '11111111-1111-1111-1111-111111111111', 'Business Profile', 'knowledge-base/d2c-skincare/business-profile.md', 'active');

-- Approved message template
INSERT INTO message_templates (id, organization_id, template_key, name, content, language, status, category)
VALUES (
  '77777777-7777-7777-7777-777777777777',
  '11111111-1111-1111-1111-111111111111',
  'qualified_lead_24h_followup',
  'Lead Follow-up (24h)',
  'Hi {{name}}, thanks for your interest in GlowRoot Skincare! We wanted to follow up on your enquiry about {{product}}. Would you like to continue the conversation?',
  'en',
  'approved',
  'marketing'
);
