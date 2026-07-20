#!/usr/bin/env node
/**
 * Backfill phone-number encryption at rest for the `contacts` table.
 *
 * For every contact that still has a plaintext `phone_number` and no
 * `phone_bidx`, this computes the AES-256-GCM ciphertext (`phone_enc`) and the
 * keyed HMAC blind index (`phone_bidx`) from the current number, then replaces
 * `phone_number` with a privacy-preserving mask (e.g. `+91••••••7368`).
 *
 * The crypto here MUST match packages/mcp-business-tools/src/crypto.ts (SecretBox):
 *   - key      = sha256(ENCRYPTION_KEY)
 *   - phone_enc = v1:<iv-hex>:<tag-hex>:<ct-hex>  (aes-256-gcm)
 *   - phone_bidx = hmac-sha256(key, value.trim().toLowerCase())
 * so the running app can decrypt/look up the values it backfilled.
 *
 * Idempotent: rows that already have `phone_bidx` are skipped. Safe to re-run.
 *
 * Requires env: ENCRYPTION_KEY, NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 * Usage: node scripts/backfill-contact-pii.mjs
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCipheriv, createHash, createHmac, randomBytes } from 'node:crypto';

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
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}
if (!ENCRYPTION_KEY) {
  console.error('Missing ENCRYPTION_KEY (must match the app\'s encryption key)');
  process.exit(1);
}

// ─── Crypto mirror of SecretBox (packages/mcp-business-tools/src/crypto.ts) ───
const KEY = createHash('sha256').update(ENCRYPTION_KEY).digest();

function encrypt(plaintext) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', KEY, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('hex')}:${tag.toString('hex')}:${ct.toString('hex')}`;
}

function blindIndex(value) {
  return createHmac('sha256', KEY).update(value.trim().toLowerCase()).digest('hex');
}

function maskPhone(phone) {
  const raw = (phone ?? '').trim();
  if (!raw) return raw;
  const hasPlus = raw.startsWith('+');
  const digits = raw.replace(/\D/g, '');
  const prefix = hasPlus ? '+' : '';
  if (digits.length <= 4) return `${prefix}${digits}`;
  const last4 = digits.slice(-4);
  const hintLen = digits.length >= 8 ? 2 : 0;
  const hint = digits.slice(0, hintLen);
  const maskedCount = Math.max(digits.length - hintLen - 4, 1);
  return `${prefix}${hint}${'•'.repeat(maskedCount)}${last4}`;
}

function normalizePhone(phone) {
  const trimmed = (phone ?? '').trim();
  return trimmed.startsWith('+') ? trimmed : `+${trimmed}`;
}

// ─── Supabase REST helpers ───────────────────────────────────────────────────
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
  if (!res.ok) throw new Error(`${method} ${path} failed: ${res.status} ${JSON.stringify(json)}`);
  return json;
}

async function main() {
  console.log(`Backfilling contact PII encryption on ${SUPABASE_URL} ...`);

  let migrated = 0;
  let skipped = 0;
  const pageSize = 500;

  // Only rows that still need encrypting: non-null phone_number and null phone_bidx.
  const query =
    `/rest/v1/contacts?select=id,phone_number,phone_bidx&phone_number=not.is.null&phone_bidx=is.null&limit=${pageSize}`;

  // Rows drop out of the filter once updated, so we can keep paging from the top.
  for (;;) {
    const rows = await rest('GET', query);
    if (!Array.isArray(rows) || rows.length === 0) break;

    for (const row of rows) {
      if (row.phone_bidx) { skipped += 1; continue; } // idempotent guard
      const normalized = normalizePhone(row.phone_number);
      await rest(
        'PATCH',
        `/rest/v1/contacts?id=eq.${row.id}`,
        {
          phone_number: maskPhone(normalized),
          phone_enc: encrypt(normalized),
          phone_bidx: blindIndex(normalized),
        },
        { Prefer: 'return=minimal' },
      );
      migrated += 1;
    }

    if (rows.length < pageSize) break;
  }

  console.log(`Backfill complete. Encrypted ${migrated} contact(s); skipped ${skipped} already-encrypted.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
