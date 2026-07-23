#!/usr/bin/env node
/**
 * Single source of truth for deploying to Vercel — used by BOTH `pnpm deploy`
 * locally and the GitHub Actions `deploy` job.
 *
 * Why this exists: the app package.json files carry `workspace:*` deps, which
 * make Vercel's `npm install` fail. So we never ship them. Instead we bundle
 * each app to a single artifact (esbuild for the gateway, Vite for the web),
 * then deploy it inside a clean, deps-free scaffold from `deploy/<app>/`
 * (installCommand = "echo prebuilt"). That scaffold is committed, so CI and a
 * laptop produce byte-identical deploys — no hand-managed `.vercel-deploy`.
 *
 * Usage:  node scripts/deploy.mjs <gateway|web|all>
 * Env:    VERCEL_TOKEN            (required)
 *         VERCEL_ORG_ID          (optional — defaults below)
 *         VERCEL_GATEWAY_PROJECT_ID / VERCEL_WEB_PROJECT_ID (optional)
 *         SKIP_ALIAS=1           (skip the vercel alias step)
 */
import { execSync } from 'node:child_process';
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TOKEN = process.env.VERCEL_TOKEN;
const ORG_ID = process.env.VERCEL_ORG_ID || 'team_nFuDie1r5UGIJfiCIoFx8TiN';

const PROJECTS = {
  gateway: {
    projectId: process.env.VERCEL_GATEWAY_PROJECT_ID || 'prj_MJOsV8irKUOoCuMjCGf7G1dJ8Cfs',
    alias: 'saarthione-api.vercel.app',
    build: 'pnpm --filter @business-os-ai/gateway-api build:vercel',
    assemble(out) {
      cpSync(join(ROOT, 'deploy/gateway'), out, { recursive: true });
      mkdirSync(join(out, 'api'), { recursive: true });
      cpSync(join(ROOT, 'apps/gateway-api/api/index.js'), join(out, 'api/index.js'));
    },
  },
  web: {
    projectId: process.env.VERCEL_WEB_PROJECT_ID || 'prj_419brICccC7wCHTjZb1YLNXNHjQq',
    alias: 'saarthione.vercel.app',
    build: 'pnpm --filter @business-os-ai/web build',
    assemble(out) {
      cpSync(join(ROOT, 'deploy/web'), out, { recursive: true });
      cpSync(join(ROOT, 'apps/web/dist'), join(out, 'dist'), { recursive: true });
    },
  },
};

function sh(cmd, opts = {}) {
  return execSync(cmd, { stdio: 'inherit', cwd: ROOT, ...opts });
}

// CI passes a token; a logged-in laptop uses ambient `vercel login` auth.
const TOKEN_FLAG = TOKEN ? `--token=${TOKEN}` : '';

function deployOne(name) {
  const p = PROJECTS[name];
  if (!p) throw new Error(`Unknown app "${name}". Use: gateway | web | all`);
  if (!TOKEN) console.warn('VERCEL_TOKEN not set — using ambient `vercel login` auth.');

  console.log(`\n=== [${name}] build ===`);
  sh(p.build);

  console.log(`=== [${name}] assemble clean deploy dir ===`);
  const out = join(ROOT, `.deploy-tmp/${name}`);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  p.assemble(out);

  if (process.env.DRY_RUN === '1') {
    console.log(`=== [${name}] DRY_RUN — assembled ${out}, skipping deploy ===`);
    sh(`ls -R ${out} | head -40`);
    return 'dry-run';
  }

  // No `.vercel/` in the dir → the CLI resolves the project from these env vars
  // and skips the interactive link prompt.
  const env = { ...process.env, VERCEL_ORG_ID: ORG_ID, VERCEL_PROJECT_ID: p.projectId };

  console.log(`=== [${name}] vercel deploy --prod ===`);
  // Capture stdout+stderr together (the CLI prints progress + the URL across
  // both), strip ANSI, then pull the immutable deployment URL off the
  // "Production" line. Regex-based so CLI cosmetic changes don't break it.
  const raw = execSync(`vercel deploy --prod --yes ${TOKEN_FLAG} 2>&1`, {
    cwd: out,
    env,
    encoding: 'utf8',
  });
  const clean = raw.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').replace(/\x1b\][^\x07]*\x07/g, '');
  const prodLine = clean.split('\n').reverse().find((l) => /Production/i.test(l) && /https:\/\//.test(l));
  const m = (prodLine || clean).match(/https:\/\/[^\s]+?\.vercel\.app/);
  if (!m) {
    console.log(clean);
    throw new Error(`could not parse deployment URL for ${name}`);
  }
  const url = m[0];
  console.log(`deployed ${name} → ${url}`);

  if (process.env.SKIP_ALIAS !== '1') {
    console.log(`=== [${name}] alias → ${p.alias} ===`);
    // Non-fatal: if the custom domain is already the project's production
    // domain, `--prod` already updated it and this is a harmless no-op.
    try {
      sh(`vercel alias set ${url} ${p.alias} ${TOKEN_FLAG}`, { cwd: out, env });
    } catch {
      console.warn(`  (alias step skipped/failed — ${p.alias} may auto-track prod)`);
    }
  }
  return url;
}

const target = process.argv[2] || 'all';
const apps = target === 'all' ? ['gateway', 'web'] : [target];
for (const name of apps) deployOne(name);
console.log('\n✅ deploy complete:', apps.join(', '));
