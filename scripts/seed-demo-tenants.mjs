#!/usr/bin/env node
/**
 * Demo multi-tenant seed for BusinessOS AI.
 *
 * Idempotently seeds the live Supabase project with TWO additional tenant
 * organizations (on top of the primary demo org created by
 * scripts/bootstrap-production.mjs) to showcase multi-tenancy end-to-end:
 *
 *   Tenant A — RaahiCabs  (vertical: cab-intercity)   owner@raahicabs.com
 *   Tenant B — GharSeva   (vertical: home-services)    owner@gharseva.com
 *
 * Each tenant gets its own:
 *  - organization (upserted by fixed org id)
 *  - owner auth user (email/password, email-confirmed) + organization membership
 *  - demo contact + consent opt-ins + conversation (so the dashboard isn't empty)
 *  - vertical-appropriate knowledge documents (chunk ingestion is separate)
 *  - one approved message template
 *  - a product catalog stored in `packages` (uses the generic `metadata` jsonb
 *    column added by migration 20260726000000_vertical_metadata.sql)
 *
 * Everything is upserted keyed on stable ids / slugs / (org_id, sku), so
 * re-running this script never duplicates rows.
 *
 * Requires env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *   (identical to scripts/bootstrap-production.mjs)
 * Optional env: RAAHICABS_OWNER_PASSWORD, GHARSEVA_OWNER_PASSWORD
 *   (default to the documented demo passwords below)
 *
 * NOTE: `packages.duration_days` carries a CHECK (duration_days > 0) constraint
 * from the travel schema migration, so these same-day cab/home-service rows use
 * duration_days = 1 (a "single-day" service). The real duration semantics live
 * in metadata (estimatedHours / hoursPerVisit).
 *
 * Usage: node scripts/seed-demo-tenants.mjs
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Minimal .env loader (no dependency on dotenv) — mirrors bootstrap-production.mjs
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

/** Upsert rows via PostgREST, merging duplicates on the conflict target. */
async function upsert(table, rows, onConflict) {
  if (!rows.length) return;
  const qs = onConflict ? `?on_conflict=${onConflict}` : '';
  const r = await rest('POST', `/rest/v1/${table}${qs}`, rows, {
    Prefer: 'resolution=merge-duplicates,return=minimal',
  });
  if (!r.ok) throw new Error(`upsert ${table} failed: ${r.status} ${JSON.stringify(r.json)}`);
  console.log(`    ✓ ${table}: ${rows.length} row(s)`);
}

/**
 * Idempotently ensure an email/password owner auth user exists.
 * Returns the auth user id. Mirrors bootstrap-production.mjs.
 */
async function ensureOwner(email, password, fullName) {
  const existing = await rest('GET', `/auth/v1/admin/users?page=1&per_page=200`);
  const found = existing.ok
    ? (existing.json.users ?? []).find((u) => u.email === email)
    : undefined;
  if (found) {
    console.log(`    ✓ auth user exists: ${email}`);
    return found.id;
  }
  if (!password) throw new Error(`password required to create owner ${email}`);
  const created = await rest('POST', '/auth/v1/admin/users', {
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });
  if (!created.ok) throw new Error(`create user ${email} failed: ${JSON.stringify(created.json)}`);
  console.log(`    ✓ auth user created: ${email}`);
  return created.json.id;
}

// Same-day services still need duration_days > 0 (CHECK constraint from the
// travel schema). Real duration lives in metadata.
const SAME_DAY = 1;

// ---------------------------------------------------------------------------
// Tenant definitions
// ---------------------------------------------------------------------------

const CAB_INCLUSIONS = [
  'Tolls & state tax included',
  'Verified professional driver',
  'Doorstep pickup',
  '24×7 support',
];

const HOME_INCLUSIONS = [
  'Background-verified staff',
  'Free replacement guarantee',
  'No advance to staff',
  'Trained & insured',
];

/** Helper to build a cab-route package row. */
function cabRoute(orgId, sku, fromCity, toCity, vehicleClass, seats, fare, estimatedHours) {
  return {
    organization_id: orgId,
    sku,
    title: `${fromCity} → ${toCity} (${vehicleClass === 'suv' ? 'SUV' : 'Sedan'})`,
    duration_days: SAME_DAY,
    price_per_person: fare,
    currency: 'INR',
    inclusions: CAB_INCLUSIONS,
    status: 'active',
    metadata: { type: 'cab-route', fromCity, toCity, vehicleClass, seats, oneWay: true, estimatedHours },
  };
}

/** Helper to build a home-service package row. */
function homePlan(orgId, sku, title, price, service, planType, hoursPerVisit, visitsPerMonth, area) {
  return {
    organization_id: orgId,
    sku,
    title,
    duration_days: SAME_DAY,
    price_per_person: price,
    currency: 'INR',
    inclusions: HOME_INCLUSIONS,
    status: 'active',
    metadata: { type: 'home-service', service, planType, hoursPerVisit, visitsPerMonth, area },
  };
}

const WEALTH_INCLUSIONS = [
  'Zero-commission direct mutual funds',
  'Goal tracking & auto-rebalance alerts',
  'Paperless KYC assistance',
  'Auto-debit SIP setup',
  'Access to a SEBI-registered advisor',
];

/**
 * Helper to build a wealth / investment "plan" as a catalog package. Price is
 * the minimum investment; the real product attributes live in metadata. (No
 * guaranteed-return fields — VriddhiX never promises returns.)
 */
function wealthPlan(orgId, sku, title, minInvestment, mode, category, riskBand, horizonYears, lockInMonths) {
  return {
    organization_id: orgId,
    sku,
    title,
    duration_days: SAME_DAY, // schema needs >0; real horizon is in metadata
    price_per_person: minInvestment,
    currency: 'INR',
    inclusions: WEALTH_INCLUSIONS,
    status: 'active',
    metadata: { type: 'investment-plan', mode, category, riskBand, minInvestment, horizonYears, lockInMonths },
  };
}

const TENANTS = [
  {
    key: 'RaahiCabs',
    orgId: '22222222-2222-2222-2222-222222222222',
    org: {
      name: 'RaahiCabs',
      slug: 'raahicabs',
      vertical: 'cab-intercity',
      settings: {
        enabled_verticals: ['cab-intercity'],
        timezone: 'Asia/Kolkata',
        business_hours: { start: '06:00', end: '23:00' },
      },
    },
    owner: {
      email: process.env.RAAHICABS_OWNER_EMAIL ?? 'owner@raahicabs.com',
      password: process.env.RAAHICABS_OWNER_PASSWORD ?? 'RaahiCabs$2026!',
      fullName: 'RaahiCabs Owner',
    },
    // Fixed ids so re-runs are idempotent (v4 UUIDs, distinct per record).
    contact: {
      id: '22222222-0000-4000-8000-000000000001',
      phone_number: '+919810012345',
      name: 'Rohit Verma',
      email: 'rohit.verma@example.com',
    },
    consentIds: ['22222222-0000-4000-8000-000000000002', '22222222-0000-4000-8000-000000000003'],
    conversationId: '22222222-0000-4000-8000-000000000004',
    docs: [
      ['22222222-0000-4000-8000-000000000011', 'Cancellation Policy', 'knowledge-base/cab-intercity/cancellation-policy.md',
        'RaahiCabs cancellation policy: free cancellation up to 2 hours before pickup. Cancellations within 2 hours of pickup incur a 25% charge; no-shows are charged in full. Refunds are processed to the original payment method within 5-7 business days.'],
      ['22222222-0000-4000-8000-000000000012', 'Pricing & Tolls Policy', 'knowledge-base/cab-intercity/pricing-policy.md',
        'RaahiCabs pricing is all-inclusive for one-way intercity trips: the quoted fare covers tolls, state/border taxes, driver allowance and fuel. Waiting beyond 45 minutes at pickup is charged at ₹150 per hour. Night trips (11 PM - 6 AM) may carry a 10% surcharge. Sedans seat up to 4 guests; SUVs seat up to 6.'],
    ],
    template: {
      template_key: 'ride_booking_confirmation',
      name: 'Ride Booking Confirmation',
      content: 'Hi {{name}}, your RaahiCabs booking from {{from}} to {{to}} is confirmed for {{date}}. Your driver details will be shared 1 hour before pickup. Safe travels!',
      language: 'en',
      status: 'approved',
      category: 'utility',
    },
    packages: (orgId) => [
      cabRoute(orgId, 'RC-DEL-JAI-SED', 'Delhi', 'Jaipur', 'sedan', 4, 3499, 5),
      cabRoute(orgId, 'RC-DEL-AGR-SED', 'Delhi', 'Agra', 'sedan', 4, 2999, 4),
      cabRoute(orgId, 'RC-MUM-PUN-SED', 'Mumbai', 'Pune', 'sedan', 4, 2499, 3),
      cabRoute(orgId, 'RC-MUM-PUN-SUV', 'Mumbai', 'Pune', 'suv', 6, 3799, 3),
      cabRoute(orgId, 'RC-BLR-MYS-SED', 'Bangalore', 'Mysore', 'sedan', 4, 2799, 3.5),
      cabRoute(orgId, 'RC-CHN-PDY-SUV', 'Chennai', 'Pondicherry', 'suv', 6, 4299, 3.5),
      cabRoute(orgId, 'RC-DEL-CHD-SED', 'Delhi', 'Chandigarh', 'sedan', 4, 3299, 4.5),
      cabRoute(orgId, 'RC-HYD-VJA-SUV', 'Hyderabad', 'Vijayawada', 'suv', 6, 5499, 5),
    ],
  },
  {
    key: 'GharSeva',
    orgId: '33333333-3333-3333-3333-333333333333',
    org: {
      name: 'GharSeva',
      slug: 'gharseva',
      vertical: 'home-services',
      settings: {
        enabled_verticals: ['home-services'],
        timezone: 'Asia/Kolkata',
        business_hours: { start: '07:00', end: '20:00' },
      },
    },
    owner: {
      email: process.env.GHARSEVA_OWNER_EMAIL ?? 'owner@gharseva.com',
      password: process.env.GHARSEVA_OWNER_PASSWORD ?? 'GharSeva$2026!',
      fullName: 'GharSeva Owner',
    },
    contact: {
      id: '33333333-0000-4000-8000-000000000001',
      phone_number: '+919920067890',
      name: 'Anjali Nair',
      email: 'anjali.nair@example.com',
    },
    consentIds: ['33333333-0000-4000-8000-000000000002', '33333333-0000-4000-8000-000000000003'],
    conversationId: '33333333-0000-4000-8000-000000000004',
    docs: [
      ['33333333-0000-4000-8000-000000000011', 'Replacement Guarantee', 'knowledge-base/home-services/replacement-policy.md',
        'GharSeva free replacement guarantee: if you are not satisfied with an assigned staff member, request a replacement at no extra cost and we will assign a new professional within 48 hours. Monthly plans can be paused or cancelled with 7 days notice; unused days are refunded on a pro-rata basis.'],
      ['33333333-0000-4000-8000-000000000012', 'Staff Verification Policy', 'knowledge-base/home-services/verification-policy.md',
        'Every GharSeva professional is background-verified with Aadhaar and police verification, skill-assessed, and covered under our insurance program. Never pay any advance directly to staff — all payments are handled securely through GharSeva. Report any issue on our 24×7 helpline.'],
    ],
    template: {
      template_key: 'service_visit_reminder',
      name: 'Service Visit Reminder',
      content: 'Hi {{name}}, this is a reminder that your GharSeva {{service}} visit is scheduled for {{date}} at {{time}}. Your verified professional {{staff}} will arrive on time. Reply to reschedule.',
      language: 'en',
      status: 'approved',
      category: 'utility',
    },
    packages: (orgId) => [
      homePlan(orgId, 'GS-COOK-M2', 'Monthly Cooking — 2 hrs/day', 6500, 'cooking', 'monthly', 2, 30, 'Bengaluru — Whitefield'),
      homePlan(orgId, 'GS-COOK-M1', 'Monthly Cooking — 1 hr/day (single meal)', 4000, 'cooking', 'monthly', 1, 30, 'Delhi NCR — Gurgaon'),
      homePlan(orgId, 'GS-CLEAN-M1', 'Monthly Cleaning — 1 hr/day', 4500, 'cleaning', 'monthly', 1, 30, 'Delhi NCR — Gurgaon'),
      homePlan(orgId, 'GS-DEEP-1', 'One-time Deep Clean — 4 hrs', 2999, 'cleaning', 'one-time', 4, 1, 'Mumbai — Andheri'),
      homePlan(orgId, 'GS-COMBO-M3', 'Cooking + Cleaning Combo — 3 hrs/day', 9500, 'cooking-cleaning', 'monthly', 3, 30, 'Mumbai — Andheri'),
      homePlan(orgId, 'GS-FT-M8', 'Full-time Live-out Maid — 8 hrs', 18000, 'full-time', 'monthly', 8, 30, 'Bengaluru — Whitefield'),
      homePlan(orgId, 'GS-BABY-M6', 'Babysitting — 6 hrs/day', 15000, 'babysitting', 'monthly', 6, 26, 'Delhi NCR — Gurgaon'),
      homePlan(orgId, 'GS-ELDER-M5', 'Elderly Care — 5 hrs/day', 16000, 'elderly-care', 'monthly', 5, 26, 'Bengaluru — Whitefield'),
    ],
  },
  {
    key: 'VriddhiX',
    orgId: '55555555-5555-5555-5555-555555555555',
    org: {
      name: 'VriddhiX',
      slug: 'vriddhix',
      vertical: 'financial-services',
      settings: {
        enabled_verticals: ['financial-services'],
        timezone: 'Asia/Kolkata',
        business_hours: { start: '09:00', end: '19:00' },
      },
      // Compliance persona injected into the agent's LLM prompt (business rules
      // tone) — VriddhiX educates, never promises returns, and hands off advice.
      business_rules: {
        languages: ['en', 'hi'],
        tone:
          'You are the friendly AI guide for VriddhiX, a wealth & investments firm in India. Explain SIPs, mutual funds, ELSS and goal-based investing simply and warmly. ALWAYS remind customers that mutual fund investments are subject to market risks and past performance does not guarantee future returns. NEVER promise, guarantee or predict specific returns. For personalised advice, large lump-sum decisions, or tax/legal specifics, offer to connect a SEBI-registered advisor and hand off to a human. Amounts are in INR (₹).',
        bookingRequiresPayment: false,
        refundRequiresApproval: true,
        workingHours: { start: '09:00', end: '19:00', timezone: 'Asia/Kolkata' },
      },
      enabled_agents: ['sales', 'support', 'booking', 'operations'],
    },
    owner: {
      email: process.env.VRIDDHIX_OWNER_EMAIL ?? 'owner@vriddhix.com',
      password: process.env.VRIDDHIX_OWNER_PASSWORD ?? 'VriddhiX$2026!',
      fullName: 'VriddhiX Owner',
    },
    contact: {
      id: '55555555-0000-4000-8000-000000000001',
      phone_number: '+919810055555',
      name: 'Neha Kapoor',
      email: 'neha.kapoor@example.com',
    },
    consentIds: ['55555555-0000-4000-8000-000000000002', '55555555-0000-4000-8000-000000000003'],
    conversationId: '55555555-0000-4000-8000-000000000004',
    docs: [
      ['55555555-0000-4000-8000-000000000011', 'How SIP Investing Works', 'knowledge-base/financial-services/how-sip-works.md',
        'A SIP (Systematic Investment Plan) lets you invest a fixed amount into a mutual fund every month — starting from as little as ₹500. Because you buy more units when prices are low and fewer when high, your average cost is smoothed out over time (rupee-cost averaging), and long-term compounding does the heavy lifting. SIPs build discipline and remove the need to time the market. Mutual fund investments are subject to market risks; returns are not guaranteed and past performance does not indicate future results. You can pause, increase, or stop a SIP anytime with no penalty (except ELSS which has a lock-in).'],
      ['55555555-0000-4000-8000-000000000012', 'Getting Started & KYC', 'knowledge-base/financial-services/kyc-getting-started.md',
        'To start investing with VriddhiX you complete a one-time paperless KYC using your PAN and Aadhaar — it takes about 5 minutes and is verified digitally. Once KYC is done you can begin a SIP or a lump-sum investment. Minimum SIP is ₹500/month for most funds. There is no account-opening fee and VriddhiX offers direct (zero-commission) plans. You can set up auto-debit from your bank so your SIP runs automatically each month.'],
      ['55555555-0000-4000-8000-000000000013', 'Risk, Returns & Diversification', 'knowledge-base/financial-services/risk-and-returns.md',
        'Every mutual fund carries risk, described by a risk band from Low (liquid/debt funds) to Very High (small-cap equity). Higher potential growth comes with higher short-term ups and downs. VriddhiX never promises or guarantees returns — anyone promising "guaranteed" mutual-fund returns is a red flag. We help you match funds to your goal and time horizon and diversify across categories so no single market swing hurts you badly. For goals under 3 years, prefer debt/hybrid; for 5+ years, equity historically rewards patience — but always subject to market risk.'],
      ['55555555-0000-4000-8000-000000000014', 'Tax Saving with ELSS (80C)', 'knowledge-base/financial-services/elss-tax.md',
        'ELSS (Equity Linked Savings Scheme) funds let you claim up to ₹1.5 lakh deduction under Section 80C of the Income Tax Act (old regime), while investing in equity for long-term growth. ELSS has the shortest lock-in among 80C options — just 3 years. Gains above ₹1 lakh a year are taxed as long-term capital gains at 10%. VriddhiX can suggest ELSS funds for tax-saving, but for personalised tax advice we connect you with a SEBI-registered advisor. Investments are subject to market risk.'],
      ['55555555-0000-4000-8000-000000000015', 'Withdrawals, Lock-in & Exit Load', 'knowledge-base/financial-services/redemption-lockin.md',
        'Most mutual funds are fully liquid — you can redeem anytime and money reaches your bank in 1-3 working days. Some funds charge a small exit load (often 1%) if you withdraw within a year, to discourage very short-term trading. ELSS funds are locked in for 3 years from each installment. Liquid funds have no lock-in and are ideal for an emergency fund. VriddhiX shows any exit load before you invest so there are no surprises.'],
    ],
    template: {
      template_key: 'portfolio_review_reminder',
      name: 'Portfolio Review Reminder',
      content: 'Hi {{name}}, your VriddhiX portfolio review is due. Your SIPs are progressing toward your {{goal}} goal. Reply REVIEW to book a free call with a SEBI-registered advisor. Mutual funds are subject to market risk.',
      language: 'en',
      status: 'approved',
      category: 'utility',
    },
    packages: (orgId) => [
      wealthPlan(orgId, 'VX-SIP-INDEX', 'SIP Starter — Nifty 50 Index Fund', 500, 'SIP', 'equity-index', 'Moderate', 5, 0),
      wealthPlan(orgId, 'VX-SIP-BALANCED', 'Balanced Advantage Fund SIP', 2000, 'SIP', 'hybrid', 'Moderate', 5, 0),
      wealthPlan(orgId, 'VX-ELSS-TAX', 'Tax Saver ELSS (80C)', 500, 'SIP', 'elss-equity', 'Moderately High', 3, 36),
      wealthPlan(orgId, 'VX-SIP-WEALTH', 'Wealth Builder — Flexi-cap Equity SIP', 5000, 'SIP', 'equity-flexicap', 'High', 7, 0),
      wealthPlan(orgId, 'VX-SIP-RETIRE', 'Retirement Goal Plan', 3000, 'SIP', 'hybrid-retirement', 'Moderate', 15, 0),
      wealthPlan(orgId, 'VX-LIQUID-EMERGENCY', 'Emergency Fund — Liquid Fund', 1000, 'SIP', 'debt-liquid', 'Low', 1, 0),
      wealthPlan(orgId, 'VX-GOLD-SIP', 'Digital Gold SIP', 500, 'SIP', 'gold', 'Moderate', 5, 0),
      wealthPlan(orgId, 'VX-LUMPSUM-ADVISORY', 'Lump-sum Advisory Portfolio', 100000, 'Lumpsum', 'advisory-diversified', 'Moderately High', 5, 0),
    ],
  },
];

// ---------------------------------------------------------------------------
// Seeding
// ---------------------------------------------------------------------------

async function seedTenant(t) {
  console.log(`\n▶ Tenant: ${t.key} (${t.orgId})`);

  // 1. Organization
  await upsert('organizations', [{ id: t.orgId, ...t.org }], 'id');

  // 2. Owner auth user + membership
  const userId = await ensureOwner(t.owner.email, t.owner.password, t.owner.fullName);
  await upsert('organization_members', [{
    organization_id: t.orgId,
    user_id: userId,
    role: 'owner',
  }], 'organization_id,user_id');

  // 3. Demo contact + consent opt-ins + conversation
  await upsert('contacts', [{
    id: t.contact.id,
    organization_id: t.orgId,
    phone_number: t.contact.phone_number,
    name: t.contact.name,
    email: t.contact.email,
  }], 'organization_id,phone_number');

  await upsert('consent_records', [
    { id: t.consentIds[0], organization_id: t.orgId, contact_id: t.contact.id, consent_type: 'marketing', action: 'opt_in', source: 'whatsapp_first_message' },
    { id: t.consentIds[1], organization_id: t.orgId, contact_id: t.contact.id, consent_type: 'transactional', action: 'opt_in', source: 'whatsapp_first_message' },
  ], 'id');

  await upsert('conversations', [{
    id: t.conversationId,
    organization_id: t.orgId,
    contact_id: t.contact.id,
    channel: 'whatsapp',
    status: 'active',
  }], 'id');

  // 4. Knowledge documents (chunks ingested separately with real embeddings)
  await upsert('knowledge_documents', t.docs.map(([id, title, source_path]) => ({
    id, organization_id: t.orgId, title, source_path, status: 'active',
  })), 'id');

  // 5. Approved message template
  await upsert('message_templates', [{
    organization_id: t.orgId,
    ...t.template,
  }], 'organization_id,template_key');

  // 6. Product catalog (packages, with vertical metadata)
  const pkgs = t.packages(t.orgId);
  await upsert('packages', pkgs, 'organization_id,sku');

  return { key: t.key, orgId: t.orgId, email: t.owner.email, password: t.owner.password, catalog: pkgs.length };
}

async function main() {
  console.log(`Seeding demo tenants into ${SUPABASE_URL} ...`);

  const only = process.env.SEED_ONLY;
  const tenants = only ? TENANTS.filter((t) => t.key.toLowerCase() === only.toLowerCase()) : TENANTS;
  const results = [];
  for (const t of tenants) {
    results.push(await seedTenant(t));
  }

  console.log('\n────────────────────────────────────────────────────────');
  console.log('Demo tenant seeding complete. Owner logins:');
  for (const r of results) {
    console.log(`  • ${r.key}`);
    console.log(`      org id   : ${r.orgId}`);
    console.log(`      email    : ${r.email}`);
    console.log(`      password : ${r.password}`);
    console.log(`      catalog  : ${r.catalog} package(s)`);
  }
  console.log('────────────────────────────────────────────────────────');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
