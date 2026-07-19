# GO-LIVE — Production Runbook

Last updated: 2026-07-19

## What is live right now

| Component | URL / Location | Status |
|---|---|---|
| Gateway API (webhook + agent runtime) | https://business-os-gateway.vercel.app | ✅ Live (Vercel, project `business-os-gateway`) |
| Operator dashboard | https://business-os-web.vercel.app | ✅ Live (Vercel, project `business-os-web`) |
| Database (Postgres + pgvector + Auth) | Supabase project `business-os-ai`, ref `vhszjxrqgmfiiooshjqf`, region Mumbai (ap-south-1) | ✅ Live, 30+ tables, RLS enabled, seeded |
| Scheduler | Vercel Cron → `GET /internal/scheduler/run`, daily 09:30 UTC | ✅ Live (Hobby plan allows daily only — see below) |
| LLM (Vercel AI Gateway via OIDC) | `anthropic/claude-sonnet-4.5` + `openai/text-embedding-3-small` | ⚠️ One click away — see step 1 |
| WhatsApp (Meta Cloud API) | Adapter fully implemented incl. HMAC verification | ⚠️ Needs your Meta credentials — see step 2 |
| Payments (Razorpay payment links + webhook) | `POST /webhooks/razorpay` | ⚠️ Needs your Razorpay keys — see step 3 |

**Dashboard login:** `puneetj79@gmail.com` — password is in `.credentials.local.md` (not committed). Change it after first login.

The agent pipeline is verified end-to-end in production: inbound webhook → durable dedup (`webhook_events`) → contact/conversation/message persistence → agent graph (intent → policy gates → tools → RAG grounding) → reply → persistence. Until the LLM is unlocked (step 1) replies use the deterministic policy-engine templates over real catalog/DB data; with the LLM they become fully composed, grounded responses.

## Step 1 — Unlock the LLM (2 minutes, one of two options)

The deployment already authenticates to Vercel AI Gateway via OIDC (verified live — the request reaches the gateway). Vercel just requires a card on file to release the free credits:

- **Option A (recommended):** Add a credit card to the Vercel team → https://vercel.com/account (AI → Add card). No code or env change needed. Free credits apply; usage is billed per token afterwards.
- **Option B:** Set a direct provider key on the gateway project:
  ```bash
  cd apps/gateway-api/.vercel-deploy
  printf 'sk-ant-...' | vercel env add ANTHROPIC_API_KEY production
  vercel deploy --prod --yes
  ```

Then verify (INTERNAL_API_KEY is in the root `.env`):
```bash
curl https://business-os-gateway.vercel.app/internal/llm/health -H "x-internal-key: $INTERNAL_API_KEY"
```
Expect `completion.ok: true` and `embedding.ok: true`.

**After embeddings work, ingest the knowledge base with real vectors:**
```bash
node scripts/ingest-knowledge-base.mjs
```
This reads `knowledge-base/d2c-skincare/*.md` and POSTs them to `/internal/rag/ingest`, which chunks, embeds (1536-dim) and stores them in `knowledge_chunks` (pgvector, tenant-scoped, cosine-similarity RPC `match_knowledge_chunks`).

## Step 2 — Connect WhatsApp

You can use **either Twilio (easiest) or Meta**. The gateway picks Twilio first if its credentials are set, otherwise Meta, otherwise a local mock. Both are fully implemented (send + inbound + signature verification).

### Option A — Twilio (recommended for a fast start; no business verification)

1. Sign up at https://twilio.com → Console. Note your **Account SID** and **Auth Token** (Console home).
2. Open **Messaging → Try it out → Send a WhatsApp message** to activate the **WhatsApp Sandbox**. Follow the instructions to join (send `join <two-words>` from your phone to the sandbox number, e.g. `+1 415 523 8886`).
3. In the sandbox settings, set **"When a message comes in"** to:
   `https://business-os-gateway.vercel.app/webhooks/twilio` (HTTP POST).
4. Set the credentials on the gateway:
   ```bash
   cd apps/gateway-api/.vercel-deploy
   printf 'ACxxxxxxxx'  | vercel env add TWILIO_ACCOUNT_SID production
   printf '<auth-token>' | vercel env add TWILIO_AUTH_TOKEN production
   printf '+14155238886' | vercel env add TWILIO_WHATSAPP_NUMBER production
   printf 'https://business-os-gateway.vercel.app/webhooks/twilio' | vercel env add TWILIO_WEBHOOK_URL production
   vercel deploy --prod --yes
   ```
5. Message the sandbox number from your joined phone — the reply flows through the agent and appears in the dashboard. Requests are validated with the `X-Twilio-Signature` HMAC. Confirm the active provider anytime:
   ```bash
   curl https://business-os-gateway.vercel.app/internal/llm/health -H "x-internal-key: $INTERNAL_API_KEY"
   # → "whatsappProvider": "twilio"
   ```
   The sandbox can message anyone who has joined it; for unrestricted sending, move to a Twilio WhatsApp Sender (Twilio handles the Meta business approval).

### Option B — Meta WhatsApp Business (direct)

1. In https://developers.facebook.com create (or open) your app → **WhatsApp → API Setup**.
2. Copy: **Phone Number ID**, a **permanent access token** (System User token with `whatsapp_business_messaging`), and the **App Secret** (App Settings → Basic).
3. Configure the webhook: URL `https://business-os-gateway.vercel.app/webhook`, Verify token = the `META_VERIFY_TOKEN` value from the root `.env` (already set on Vercel). Subscribe to the `messages` field.
4. Set the credentials:
   ```bash
   cd apps/gateway-api/.vercel-deploy
   printf '<phone-number-id>' | vercel env add META_WHATSAPP_PHONE_NUMBER_ID production
   printf '<permanent-token>' | vercel env add META_WHATSAPP_ACCESS_TOKEN production
   printf '<app-secret>'      | vercel env add META_APP_SECRET production
   vercel deploy --prod --yes
   ```
Once `META_APP_SECRET` is set, every webhook POST is HMAC-verified (`X-Hub-Signature-256`); invalid signatures are rejected with 401. Message a WhatsApp number linked to the phone number ID and watch the conversation appear in the dashboard.

## Step 3 — Connect Razorpay (optional, payments)

```bash
cd apps/gateway-api/.vercel-deploy
printf 'rzp_live_...' | vercel env add RAZORPAY_KEY_ID production
printf '<key-secret>' | vercel env add RAZORPAY_KEY_SECRET production
printf '<webhook-secret>' | vercel env add RAZORPAY_WEBHOOK_SECRET production
vercel deploy --prod --yes
```
Set the Razorpay dashboard webhook to `https://business-os-gateway.vercel.app/webhooks/razorpay` (events: `payment_link.paid`, `payment_link.expired`, `payment_link.cancelled`). Payment links are created via `RazorpayPaymentService.createPaymentLink` and persisted to the `payments` table; the webhook flips payments to `captured` and orders to `paid` after signature verification.

## Operations

- **Scheduler cadence:** Vercel Hobby allows daily crons only (currently 09:30 UTC). For minute-level automation either upgrade to Vercel Pro (then set `*/10 * * * *` in `apps/gateway-api/vercel.json`) or run the standalone worker anywhere: `pnpm --filter @business-os-ai/scheduler-worker dev` (uses root `.env`, dispatches through the gateway).
- **Internal endpoints** (all require `x-internal-key: $INTERNAL_API_KEY`):
  - `GET /internal/llm/health` — live LLM + embedding diagnostics
  - `POST /internal/rag/ingest` — `{documents:[{title,sourcePath,content}]}` → pgvector
  - `GET|POST /internal/scheduler/run` — consent-safe automation tick
  - `POST /internal/messages` — controlled outbound send
- **Redeploying the gateway after code changes:**
  ```bash
  pnpm --filter @business-os-ai/gateway-api build:vercel
  cp apps/gateway-api/api/index.js apps/gateway-api/.vercel-deploy/api/index.js
  cd apps/gateway-api/.vercel-deploy && vercel deploy --prod --yes
  ```
- **Redeploying the dashboard:**
  ```bash
  cd apps/web && pnpm build && cp -r dist .vercel-deploy/ && cd .vercel-deploy && vercel deploy --prod --yes
  ```
- **Database migrations:** `supabase db push -p <db-password>` (project is linked; password in `.credentials.local.md`).
- **LLM cost tracking:** every completion writes a row to `llm_usage` (tokens, cost, latency, per-tenant) — surfaced on the dashboard Compliance tab.
- **Security posture:** RLS on all tenant tables (`public.is_member_of`), service-role only on the server, Meta HMAC + Razorpay HMAC verification, append-only `audit_events`, durable webhook dedup, consent-gated marketing sends inside a 09:00–21:00 UTC window.
