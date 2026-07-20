# Product Requirements Document (PRD)

## 1. Product Identification
- **Product Name**: SaarthiOne — AI-Native Business Operating System
- **Target Audience**: SMBs across Travel & Tourism, Dining, Healthcare, Wellness, Education, and Retail.
- **Primary Channels**: WhatsApp Business API (Meta Cloud API / Twilio), Instagram Messaging, Facebook Messenger.
- **Live Platform**: [https://saarthione.vercel.app/](https://saarthione.vercel.app/)

---

## 2. Core Functional Requirements

### FR-1: Multi-Tenant Organization & Role Management
- Ability to onboard SMBs as isolated tenants.
- RBAC permissions (`owner`, `manager`, `sales_agent`, `support_agent`).
- Organization isolated Supabase RLS row-level security.

### FR-2: 6 Specialized AI Employees
- **Sales Agent**: Lead conversion, custom package quotes, 3.4x lead conversion benchmark.
- **Support Agent**: 24/7 policy search & instant Q&A (<2s resolution), emergency human escalation.
- **Booking Agent**: Real-time slot availability, appointment booking, zero double-booking guarantee.
- **Marketing Agent**: Broadcast campaigns, automatic promo code application, 68% WhatsApp open rates.
- **Finance Agent**: Instant Razorpay payment links, official GST tax invoice generation (PDF), refund processing.
- **Travel Agent**: Complete trip planning, flight/hotel booking concierge, and day-by-day itineraries.

### FR-3: 6-Stage Continuous Customer Journey
- **Discover**: Instant greeting from Instagram/FB click-to-WhatsApp ads with contact & consent creation.
- **Understand**: Conversational qualification (dates, budget, preferences) with `upsert_qualified_lead`.
- **Recommend**: Grounded product & package lookup (`search_travel_packages` / `searchProductCatalog`) via pgvector RAG.
- **Choose**: In-thread interactive list picker for slot, room, or service selection.
- **Pay**: Razorpay payment link generation; instant status flip upon signed webhook verification (`payment_link.paid`).
- **Retain**: Consent-safe automated follow-ups within legal UTC windows (09:00 - 21:00 UTC).

### FR-4: Multi-Industry Skill Adaptability
- **Travel & Tourism**: Package search, itinerary builder, flight/hotel vouchers.
- **Restaurant & Dining**: Table reservation, dietary preference logging, chef specials link.
- **Clinic & Healthcare**: Doctor appointment slot booking, token allocation (#CL-XXXX).
- **Salon & Wellness**: Stylist selection, hair/spa slot booking.
- **Education & Coaching**: Course inquiry, demo class registration, fee collection.
- **Retail & E-commerce**: Product catalogue lookup, order tracking (`getOrderStatus`), return claims.

### FR-5: Deterministic Governance & Escalation
- Auto-escalation of complaints, emergency situations, or low RAG confidence (<0.85) to the Operator Inbox.
- Append-only audit logging (`audit_events`) for complete decision traceability.

### FR-6: Consent-Safe Scheduler Engine
- Campaign dispatch restricted to contacts with active `marketing` opt-in consent.
- Verification of no subsequent `opt_out` consent record.
- Strict enforcement of UTC allowed sending windows (09:00 - 21:00 UTC).

