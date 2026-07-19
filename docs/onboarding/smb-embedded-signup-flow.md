# SMB Embedded Signup Flow

To onboard new small-to-medium businesses (SMBs) onto the WhatsApp SMB Platform, we implement Meta's **Embedded Signup Flow**. This allows SMBs to register their WhatsApp Business Account (WABA) and link it directly from our dashboard.

---

## 1. Web Onboarding Interface

The platform mounts Meta's SDK script inside the dashboard settings panel to open a secure registration dialog:

```html
<script src="https://sdk.facebook.net/en_US/sdk.js"></script>
<button onclick="launchWhatsAppSignup()">Link WhatsApp Business Account</button>
```

```javascript
function launchWhatsAppSignup() {
  FB.login(function(response) {
    if (response.authResponse) {
      const accessToken = response.authResponse.accessToken;
      // Exchange this token for permanent WABA details in our backend
      registerOnboardedTenant(accessToken);
    }
  }, {
    scope: 'whatsapp_business_management, whatsapp_business_messaging',
    extras: {
      feature: 'whatsapp_embedded_signup',
      setup: {
        // Pre-fill business profiles
      }
    }
  });
}
```

---

## 2. Meta OAuth Permissions Required

To operate the chatbot on behalf of the tenant, our platform requests the following scopes:

1. `whatsapp_business_management`: Allows reading WhatsApp Business Account configurations, details, and templates.
2. `whatsapp_business_messaging`: Enables sending transactional templated messages and text replies.
3. `business_management`: Allows access to Meta Business Manager accounts linked to the phone numbers.

---

## 3. Database Registration & Onboarding Lifecycle

Once the user approves the signup flow:

1. **Token Exchange**: The backend receives the short-lived access token, exchanges it for a long-lived access token, and securely saves it in `whatsapp_configurations` under the tenant's `organization_id`.
2. **Phone Registration**: The backend registers the WABA phone number for webhook delivery by setting up webhook endpoints.
3. **Database Seeding**: A default template profile is populated, and default RAG knowledge-base categories are created for the tenant in the database.
