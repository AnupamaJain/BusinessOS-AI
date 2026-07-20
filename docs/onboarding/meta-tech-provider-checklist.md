# Meta WhatsApp — Verification & Tech-Provider Checklist

These are **Meta business-process milestones**, not app code. The platform already
implements the *technical* side (Embedded Signup flow, per-org token storage,
multi-tenant webhook routing). What remains are approvals you complete in Meta.

## Where we are (code)

| Capability | Status |
|---|---|
| Embedded Signup (frontend popup + backend code→token exchange) | ✅ Implemented — activates when `META_APP_ID` + a Meta **Embedded Signup config** are set |
| Per-org WhatsApp credential storage (`whatsapp_connections`) | ✅ Implemented |
| Multi-tenant inbound routing (webhook → `phone_number_id` → org → that org's token) | ✅ Implemented |
| App subscribed to each connected WABA automatically | ✅ Implemented |

## 1. Embedded Signup configuration (unlocks self-serve onboarding)

1. Meta App Dashboard → **WhatsApp → Embedded Signup** → **Create configuration**.
2. Choose the WhatsApp Business solution, set permissions `whatsapp_business_management`, `whatsapp_business_messaging`.
3. Copy the **Configuration ID** and the **App ID**. Set them on the dashboard build:
   ```bash
   # apps/web/.env.production
   VITE_META_APP_ID=<app id>
   VITE_META_CONFIG_ID=<embedded signup config id>
   ```
   And ensure `META_APP_ID` + `META_APP_SECRET` are set on the gateway (already are).
4. Add your app's domain (`saarthione.vercel.app`) to **App Settings → Basic → App domains** and to **Facebook Login → Settings → Valid OAuth redirect URIs**.

Until App Review passes, Embedded Signup only works for users with a **role on the app** (admins/developers/testers).

## 2. Business Verification

1. **Business Settings → Business Info → Verify** (or Security Center).
2. Provide legal business name, address, phone, website (`saarthione.vercel.app`), and a document (registration certificate / utility bill).
3. Verification typically takes a few business days. Required before serving customers at scale and before Tech-Provider status.

## 3. System User token (for the platform's own number)

Business Settings → **Users → System users** → add (Admin) → **Add assets** (your app + WABA, full control) → **Generate token** with `whatsapp_business_messaging` + `whatsapp_business_management`, **expiration: Never**. Store as `META_WHATSAPP_ACCESS_TOKEN`. (Per-tenant tokens come from Embedded Signup automatically.)

## 4. App Review (public access)

1. App Dashboard → **App Review → Permissions and Features**.
2. Request advanced access for `whatsapp_business_management`, `whatsapp_business_messaging`, and (for Embedded Signup) `business_management`.
3. Provide a screencast of the Embedded Signup flow and how the AI agent replies.
4. Submit. Once approved, **any** business can complete Embedded Signup and message you.

## 5. Tech / Solution Provider status

1. Requires: verified business + approved app + a working Embedded Signup integration (all of the above).
2. Apply via the **Meta Business Partners** program (WhatsApp Business Solution Provider track), or work through an existing BSP.
3. **Line-of-Credit sharing** and consolidated conversation billing become available **only** after Tech-Provider onboarding with Meta — it is a billing arrangement configured on Meta's side, not in this codebase.

## Order of operations

Embedded Signup config → Business Verification → App Review → Tech-Provider application.
Each step gates the next. The code is ready for all of them today.
