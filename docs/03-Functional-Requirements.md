# Functional Requirements Specification

## 1. Gateway API & Webhook Ingress
- `GET /webhook`: Verify Meta Cloud API webhook subscription challenge tokens.
- `POST /webhook`: Process inbound Meta & Twilio messages, deduplicate by `provider_message_id`, and route to agent workflow.
- `POST /internal/messages`: Controlled outbound messaging endpoint for system & scheduler dispatches.
- `POST /webhooks/razorpay`: Verify Razorpay HMAC signature (`x-razorpay-signature`) and flip payment status to `captured` and booking status to `paid`.

## 2. Agent Core & Specialized AI Employees
- **Coordinator Router**: Classifies incoming messages into explicit intent categories (`sales`, `support`, `booking`, `marketing`, `finance`, `travel`, `escalation`, `opt_out`).
- **Sales Agent**: Handles lead qualification, package options, custom quotes, and conversion tracking (3.4x conversion benchmark).
- **Support Agent**: 24/7 instant resolution (<2s response time) for policy questions, visa requirements, and refund rules.
- **Booking Agent**: Real-time slot selection, calendar reservation, token allocation (#CL-XXXX), zero double-booking guarantee.
- **Marketing Agent**: Re-engagement campaigns, promo code application, consent verification, 68% WhatsApp open rates.
- **Finance Agent**: Razorpay payment link generation, GST tax invoice PDF generation, refund execution.
- **Travel Agent**: Itinerary concierge, day-by-day trip planning, hotel/flight preference logging.

## 3. RAG Retrieval & Knowledge Base
- Ingests markdown files (`travel-packages.md`, `visa-and-cancellation-policy.md`, `skincare-faq.md`).
- Generates 1536-dimensional vector embeddings (OpenAI / AI Gateway) and performs cosine similarity search filtered by `organization_id`.
- Triggers human handoff when similarity score is below grounding threshold (<0.85).

## 4. Web Application (https://saarthione.vercel.app/)
- **Interactive Hero Demonstration**: Live interactive conversation simulator highlighting daily summary stats (126 messages answered, 8 bookings, ₹74,000 recovered, 39 leads nurtured).
- **AI Employee Roster Switcher**: Interactive switcher showcasing real conversation flows across Sales, Support, Booking, Marketing, Finance, and Travel agents.
- **Multi-Industry WhatsApp Simulators**: Real WhatsApp thread rendering across Travel & Tourism, Restaurant & Dining, Clinic & Healthcare, Salon & Wellness, Education & Coaching, and Retail & E-commerce.
- **Operator Workspace**:
  - Live inbox queue to claim, reply, and resolve escalated tickets.
  - CRM leads table with real-time lead score indicators.
  - Holiday package & product catalogue manager.
  - Campaign scheduler and AI compliance gauges.
