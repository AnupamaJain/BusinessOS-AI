#!/usr/bin/env node
/**
 * Ingests knowledge-base markdown into the production RAG store
 * (real embeddings via the deployed gateway's /internal/rag/ingest).
 *
 * Usage: node scripts/ingest-knowledge-base.mjs [gateway-url]
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const envFile = resolve(root, '.env');
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf-8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
  }
}

const gatewayUrl = process.argv[2] ?? process.env.GATEWAY_URL ?? 'https://business-os-gateway.vercel.app';
const internalKey = process.env.INTERNAL_API_KEY;
if (!internalKey) {
  console.error('INTERNAL_API_KEY missing (expected in root .env)');
  process.exit(1);
}

const kbDir = join(root, 'knowledge-base', 'd2c-skincare');
const files = readdirSync(kbDir).filter((f) => f.endsWith('.md'));
const documents = files.map((f) => ({
  title: basename(f, '.md').replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
  sourcePath: `knowledge-base/d2c-skincare/${f}`,
  content: readFileSync(join(kbDir, f), 'utf-8'),
}));

console.log(`Ingesting ${documents.length} documents into ${gatewayUrl} ...`);
const res = await fetch(`${gatewayUrl}/internal/rag/ingest`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'x-internal-key': internalKey },
  body: JSON.stringify({ documents }),
});
const body = await res.text();
console.log(`HTTP ${res.status}: ${body}`);
process.exit(res.ok ? 0 : 1);
