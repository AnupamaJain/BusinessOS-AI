# Product Requirements Document (PRD)

## 1. Product Identification
- **Product Name**: SaarthiOne (Travel Skill)
- **Target Audience**: Travel agencies, tour operators, destination management companies (DMCs), boutique travel consultants.
- **Primary Channels**: WhatsApp Business API (Meta Cloud API), Instagram Messaging, Messenger.

---

## 2. Core Functional Requirements

### FR-1: Multi-Tenant Organization Management
- Ability to onboard travel agencies as isolated tenants.
- RBAC permissions (`owner`, `manager`, `sales_agent`, `support_agent`).

### FR-2: Conversational Lead Qualification
- AI Agent automatically extracts budget, dates, duration, traveler count, and destination.
- Assigns lead qualification score (0-100) and advances lead stage (`new` → `contacted` → `qualified`).

### FR-3: Grounded Package Recommendations & Itineraries
- Queries holiday package directory (`search_travel_packages`).
- Generates custom day-by-day itineraries with flight, hotel, and activity details.

### FR-4: Booking & Payment Links
- Creates booking records with unique booking numbers (`BK-XXXXX`).
- Generates payment links (Razorpay/Stripe) and dispatches receipts via WhatsApp.

### FR-5: Deterministic Policy Engine & Escalation
- Auto-escalates complaints, refund requests, and human agent requests to the Operator Inbox.
- Restricts ungrounded or out-of-scope claims.

### FR-6: Consent-Safe Automation
- Schedules follow-ups only if marketing opt-in consent exists.
- Restricts dispatch to allowed UTC sending windows (09:00 - 21:00 UTC).
