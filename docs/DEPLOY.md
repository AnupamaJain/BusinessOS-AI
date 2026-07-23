# Deploying

Deploys are **gated by CI and automated**. Merging to `main` runs the `checks`
job (typecheck + test + build); only if it passes does the `deploy` job build
and ship both apps to Vercel. A red build never reaches production.

## How it works

The app `package.json` files carry `workspace:*` deps, which make Vercel's
`npm install` fail. So we never ship them. Each app is bundled to a single
artifact and deployed inside a clean, deps-free scaffold from `deploy/<app>/`
(`installCommand: "echo prebuilt"`):

| App     | Bundle                          | Scaffold          | Domain                        |
| ------- | ------------------------------- | ----------------- | ----------------------------- |
| gateway | `esbuild` → `api/index.js`      | `deploy/gateway/` | `saarthione-api.vercel.app`   |
| web     | `vite build` → `dist/`          | `deploy/web/`     | `saarthione.vercel.app`       |

`scripts/deploy.mjs` is the **single source of truth** — the same script runs
locally and in CI, so there's no hand-managed `.vercel-deploy` drift.

## Automated (CI) — the default path

Push to `main` → `.github/workflows/ci.yml` runs `checks`, then `deploy`.

**One-time setup:** add a Vercel access token as a repo secret so CI can deploy.

1. Create a token: https://vercel.com/account/tokens (scope: the
   `orbis-quant-platform` team).
2. GitHub → repo **Settings → Secrets and variables → Actions → New secret**
   - Name: `VERCEL_TOKEN`
   - Value: the token

Until the secret exists, the `deploy` job **skips with a warning** (stays
green) — `checks` still gate every PR. Org/project IDs are non-secret and live
in the workflow/script.

## Manual (local) — escape hatch

Uses your `vercel login` session (no token needed):

```bash
pnpm deploy            # both apps
pnpm deploy gateway    # one app
pnpm deploy web
DRY_RUN=1 pnpm deploy  # build + assemble only, no deploy (inspect .deploy-tmp/)
```
