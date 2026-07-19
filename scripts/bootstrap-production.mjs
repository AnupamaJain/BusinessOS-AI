#!/usr/bin/env node
/**
 * Production bootstrap for BusinessOS AI.
 *
 * Idempotently seeds the live Supabase project with:
 *  - the demo organization (GlowRoot Skincare, travel-enabled)
 *  - an owner auth user (email/password) + organization membership
 *  - contacts/consent/conversation base records
 *  - knowledge documents, approved message templates
 *  - product catalog (skincare) and travel packages
 *
 * Requires env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 * Optional env: BOOTSTRAP_OWNER_EMAIL, BOOTSTRAP_OWNER_PASSWORD
 *
 * Usage: node scripts/bootstrap-production.mjs
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Minimal .env loader (no dependency on dotenv)
const envFile = resolve(root, '.env');
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf-8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
  }
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const ORG_ID = process.env.DEFAULT_ORG_ID ?? '11111111-1111-1111-1111-111111111111';
const OWNER_EMAIL = process.env.BOOTSTRAP_OWNER_EMAIL ?? 'puneetj79@gmail.com';
const OWNER_PASSWORD = process.env.BOOTSTRAP_OWNER_PASSWORD;

const headers = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  'Content-Type': 'application/json',
};

async function rest(method, path, body, extraHeaders = {}) {
  const res = await fetch(`${SUPABASE_URL}${path}`, {
    method,
    headers: { ...headers, ...extraHeaders },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: res.status, ok: res.ok, json };
}

/** Upsert rows via PostgREST, ignoring duplicates on conflict target. */
async function upsert(table, rows, onConflict) {
  const qs = onConflict ? `?on_conflict=${onConflict}` : '';
  const r = await rest('POST', `/rest/v1/${table}${qs}`, rows, {
    Prefer: 'resolution=merge-duplicates,return=minimal',
  });
  if (!r.ok) throw new Error(`upsert ${table} failed: ${r.status} ${JSON.stringify(r.json)}`);
  console.log(`  ✓ ${table}: ${rows.length} row(s)`);
}

async function main() {
  console.log(`Bootstrapping ${SUPABASE_URL} ...`);

  // 1. Organization
  await upsert('organizations', [{
    id: ORG_ID,
    name: 'GlowRoot Skincare',
    slug: 'glowroot-skincare',
    vertical: 'd2c-skincare',
    settings: {
      timezone: 'Asia/Kolkata',
      business_hours: { start: '09:00', end: '21:00' },
      enabled_verticals: ['d2c-skincare', 'travel'],
    },
  }], 'id');

  // 2. Owner auth user
  let userId;
  const existing = await rest('GET', `/auth/v1/admin/users?page=1&per_page=100`);
  const found = existing.ok
    ? (existing.json.users ?? []).find((u) => u.email === OWNER_EMAIL)
    : undefined;
  if (found) {
    userId = found.id;
    console.log(`  ✓ auth user exists: ${OWNER_EMAIL}`);
  } else {
    if (!OWNER_PASSWORD) throw new Error('BOOTSTRAP_OWNER_PASSWORD required to create the owner user');
    const created = await rest('POST', '/auth/v1/admin/users', {
      email: OWNER_EMAIL,
      password: OWNER_PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: 'Platform Owner' },
    });
    if (!created.ok) throw new Error(`create user failed: ${JSON.stringify(created.json)}`);
    userId = created.json.id;
    console.log(`  ✓ auth user created: ${OWNER_EMAIL}`);
  }

  // 3. Membership
  await upsert('organization_members', [{
    organization_id: ORG_ID,
    user_id: userId,
    role: 'owner',
  }], 'organization_id,user_id');

  // 4. Demo contact + consent + conversation
  await upsert('contacts', [{
    id: '33333333-3333-3333-3333-333333333333',
    organization_id: ORG_ID,
    phone_number: '+919876543210',
    name: 'Priya Sharma',
    email: 'priya@example.com',
  }], 'organization_id,phone_number');

  await upsert('consent_records', [
    { id: '44444444-4444-4444-4444-444444444444', organization_id: ORG_ID, contact_id: '33333333-3333-3333-3333-333333333333', consent_type: 'marketing', action: 'opt_in', source: 'whatsapp_first_message' },
    { id: '44444444-4444-4444-4444-444444444455', organization_id: ORG_ID, contact_id: '33333333-3333-3333-3333-333333333333', consent_type: 'transactional', action: 'opt_in', source: 'whatsapp_first_message' },
  ], 'id');

  await upsert('conversations', [{
    id: '55555555-5555-5555-5555-555555555555',
    organization_id: ORG_ID,
    contact_id: '33333333-3333-3333-3333-333333333333',
    channel: 'whatsapp',
    status: 'active',
  }], 'id');

  // 5. Knowledge documents (chunks are ingested with real embeddings via
  //    POST /internal/rag/ingest on the deployed gateway)
  const docs = [
    ['66666666-6666-6666-6666-666666666601', 'Products Catalog', 'knowledge-base/d2c-skincare/products.md'],
    ['66666666-6666-6666-6666-666666666602', 'Shipping Policy', 'knowledge-base/d2c-skincare/shipping-policy.md'],
    ['66666666-6666-6666-6666-666666666603', 'Returns Policy', 'knowledge-base/d2c-skincare/returns-policy.md'],
    ['66666666-6666-6666-6666-666666666604', 'Safety Policy', 'knowledge-base/d2c-skincare/safety-policy.md'],
    ['66666666-6666-6666-6666-666666666605', 'Business Profile', 'knowledge-base/d2c-skincare/business-profile.md'],
  ];
  await upsert('knowledge_documents', docs.map(([id, title, source_path]) => ({
    id, organization_id: ORG_ID, title, source_path, status: 'active',
  })), 'id');

  // 6. Approved template
  await upsert('message_templates', [{
    organization_id: ORG_ID,
    template_key: 'qualified_lead_24h_followup',
    name: 'Lead Follow-up (24h)',
    content: 'Hi {{name}}, thanks for your interest! We wanted to follow up on your enquiry about {{product}}. Would you like to continue the conversation?',
    language: 'en',
    status: 'approved',
    category: 'marketing',
  }], 'organization_id,template_key');

  // 7. Product catalog (skincare)
  await upsert('products', [
    { organization_id: ORG_ID, sku: 'GR-CLN-01', name: 'GlowRoot Gentle Foaming Cleanser', description: 'Sulphate-free foaming cleanser for oily and combination skin with niacinamide and green tea.', category: 'cleanser', base_price: 499, currency: 'INR', status: 'active' },
    { organization_id: ORG_ID, sku: 'GR-SRM-02', name: 'GlowRoot 10% Niacinamide Serum', description: 'Oil-control serum that reduces acne marks and minimises pores. Suitable for oily, acne-prone skin.', category: 'serum', base_price: 699, currency: 'INR', status: 'active' },
    { organization_id: ORG_ID, sku: 'GR-MST-03', name: 'GlowRoot Ceramide Moisturiser', description: 'Barrier-repair moisturiser with ceramides and hyaluronic acid for dry and sensitive skin.', category: 'moisturiser', base_price: 599, currency: 'INR', status: 'active' },
    { organization_id: ORG_ID, sku: 'GR-SPF-04', name: 'GlowRoot SPF 50 PA+++ Sunscreen', description: 'Lightweight, no-white-cast sunscreen suitable for all skin types. Water resistant.', category: 'sunscreen', base_price: 649, currency: 'INR', status: 'active' },
  ], 'organization_id,sku');

  // 8. Travel packages
  await upsert('packages', [
    { organization_id: ORG_ID, sku: 'TRV-BALI-001', title: 'Bali Honeymoon & Romance Escapes (5N/6D)', duration_days: 6, price_per_person: 49999, currency: 'INR', inclusions: ['4-Star Villa with Private Pool', 'Daily Breakfast', 'Candlelight Dinner', 'Nusa Penida Tour'], status: 'active' },
    { organization_id: ORG_ID, sku: 'TRV-EUR-002', title: 'Europe Grand Express - Paris, Swiss & Rome (7N/8D)', duration_days: 8, price_per_person: 129999, currency: 'INR', inclusions: ['4-Star Hotels with Breakfast', 'High-Speed Rail Passes', 'Eiffel Tower Access', 'Mount Titlis Cable Car'], status: 'active' },
    { organization_id: ORG_ID, sku: 'TRV-GOA-003', title: 'Goa Beach & Adventure Rush (3N/4D)', duration_days: 4, price_per_person: 14999, currency: 'INR', inclusions: ['Beachfront Resort', 'Water Sports Combo', 'Sunset Cruise', 'Daily Breakfast'], status: 'active' },
  ], 'organization_id,sku');

  console.log('Bootstrap complete.');
  console.log(`Owner login: ${OWNER_EMAIL}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
