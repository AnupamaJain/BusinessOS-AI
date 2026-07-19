# Product Requirements Document: WhatsApp SMB Growth & Support Platform

*Version 2.0 — refined with information architecture, success metrics, and compliance detail. Companion interactive UI prototype: `whatsapp-smb-platform-prototype.html`.*

## Overview

This product is a multi-tenant WhatsApp-based growth, support, and customer journey platform for SMBs. It is designed to help small and medium businesses onboard to the WhatsApp Business Platform, capture and qualify leads, answer customer questions using source-grounded retrieval, escalate complex cases to humans, and run consent-safe follow-up automation. Meta’s official platform supports inbound/outbound business messaging via webhooks and Cloud API, and Embedded Signup is the official onboarding flow for platform customers.

The platform should not be a generic chatbot builder. Its core value is reliable business workflow execution with strong tenant isolation, policy enforcement, auditability, and AI quality controls. This document is written so that a coding agent such as Claude Code can use it as a build brief and architectural reference.

## Product Vision

Enable SMBs to activate a production-ready WhatsApp sales and support assistant in a short onboarding flow, without needing in-house engineering. The assistant should capture business value across the customer lifecycle: immediate lead response, FAQ resolution, CRM-backed context, human handoff, and compliant re-engagement. Meta Business Agent positioning also validates this category by emphasizing question answering, product recommendations, booking, lead qualification, and human escalation for businesses.

## Problem Statement

SMBs commonly lose revenue and support quality because customer enquiries arrive outside business hours, responses are delayed, customer context is fragmented across systems, and follow-ups are inconsistent. The business needs one operational layer that can receive WhatsApp messages, qualify intent, route to the correct workflow, preserve CRM context, and safely automate approved actions while preventing spam, hallucinations, and cross-tenant leakage.

## Goals

- Onboard SMBs onto WhatsApp Business Platform with an in-product flow using Embedded Signup.
- Provide tenant-safe lead capture, support automation, and human handoff.
- Expose business actions through scoped MCP tools rather than unrestricted system access.
- Support source-grounded RAG responses for FAQs, policies, and product/service information.
- Run compliant reminder and follow-up workflows with opt-in, template, timing, and deduplication controls.
- Produce measurable operational outcomes: faster first response, more captured leads, better support coverage, and structured audit trails.

## Non-Goals

- No unofficial WhatsApp Web automation stack.
- No unrestricted autonomous agent with direct database or arbitrary API execution.
- No all-industry “one bot does everything” release in phase 1.
- No medical, financial, or legal autonomous resolution.
- No promise of universal uplift percentages from conference or marketing slides.

## Primary Users

### SMB owner

Needs quick onboarding, immediate value, simple dashboards, and confidence that the system is safe and compliant.

### Sales or support operator

Needs lead summaries, conversation context, handoff queues, and clear next actions.

### Platform admin

Needs tenant setup, permissions, integrations, audit visibility, and monitoring.

## Target Verticals

The first release should ship with vertical templates because SMB value is perceived through ready-made workflows, not generic abstractions.

| Vertical | Initial workflows | Why it matters |
|---|---|---|
| D2C skincare / personal care | product FAQ, lead qualification, order support, reorder reminder | High WhatsApp suitability and repeat purchase potential |
| Salon / wellness | service enquiry, booking, reminder, staff handoff | Clear ROI from reducing missed calls and no-shows |
| Coaching / education | lead capture, course qualification, counsellor handoff, reminder | Structured lead qualification and follow-up |
| Home services | service request, area qualification, quote capture, technician handoff | Speed-to-response drives conversion |

## Information Architecture & Screens

The operator-facing product is a single web dashboard (`operator-dashboard`) with role-aware navigation. Each screen maps to a functional requirement below so build order and UI scope stay traceable to the spec.

| # | Screen | Primary user | Maps to requirement |
|---|---|---|---|
| 1 | Onboarding wizard (Embedded Signup, vertical template, KB seed, team invite) | SMB owner | §Integration Requirements – Embedded Signup |
| 2 | Overview dashboard (KPIs, activity feed, connection health) | SMB owner, admin | §Success Metrics |
| 3 | Inbox (conversation list + thread + context panel) | Sales/support operator | §3 Routing, §6 Human handoff |
| 4 | Leads (kanban/table by stage, detail drawer) | Sales operator, SMB owner | §Required entities – leads |
| 5 | Handoff queue (priority list, SLA timers, take/resolve) | Support operator | §6 Human handoff |
| 6 | Knowledge base (documents, chunks, grounding confidence) | SMB owner, admin | §4 RAG quality layer |
| 7 | Automations (reminder workflows, consent + dedup rules) | SMB owner, admin | §7 Consent-safe re-engagement |
| 8 | Settings (tenant, WhatsApp connection, team, audit log) | Platform admin | §1 Tenant-safe data model, §Security |

Each screen must render its own empty state (no data yet), loading state, and error/degraded state (e.g., WhatsApp connection lost) — not just the happy path, per §Reliability.

### Cross-screen conventions

- **Route trail**: every conversation and automated send displays the LangGraph route it took (e.g. `classify → policy_check → support_flow → quality_gate → sent`) so operators can see *why* the system acted, not just what it said. This is the primary way the product visibly differentiates itself from a black-box chatbot.
- **Confidence & source chips**: any AI-generated reply shown to an operator carries a grounding confidence indicator and the source documents used, or an explicit "escalated — no confident source" state.
- **Consent state**: contacts show a persistent opt-in/opt-out badge everywhere they appear (inbox, leads, automations) so operators cannot accidentally trigger a non-consented send.

## Product Scope

### Core capabilities

1. WhatsApp Business onboarding for SMBs through Embedded Signup.
2. Tenant-safe CRM and conversation storage with RLS in Supabase.
3. LangGraph-based orchestration with explicit routing and policy gates.
4. Custom MCP server exposing safe business tools.
5. RAG support layer using approved business content and permission-aware retrieval.
6. Human handoff with bot pause/resume semantics.
7. Consent-safe follow-up and reminder automation.
8. Evaluation and QA suite covering routing, tool use, grounding, safety, and integration reliability.

### Optional later capabilities

- Shopify and WooCommerce connectors
- Freshdesk / Zoho Desk / HubSpot integrations
- Calendar and booking integrations
- Payment-link generation
- Multi-agent specialized workflows
- Advanced analytics and SLA dashboards

## Functional Requirements

## 1. Tenant-safe data model and RLS

Every SMB must be completely isolated from every other SMB. The database must use `organization_id` on all tenant-bound entities, with Row Level Security enabled so access is restricted by tenant context. Supabase documents RLS as Postgres-native defense-in-depth, and permission-aware retrieval is also supported when vector data is stored in Postgres.

### Required entities

- organizations
- organization_members
- contacts
- leads
- conversations
- messages
- handoffs
- lead_activities
- automation_runs
- audit_events
- knowledge_documents
- knowledge_chunks
- integration_connections
- consent_records
- template_sends

### Key requirements

- Every tenant-bound row must contain `organization_id`.
- All reads and writes must be scoped by tenant.
- No client-side trust of tenant or contact IDs.
- Audit events must be immutable.
- Soft delete preferred for business records; audit records never deleted.

## 2. Custom MCP tools

Business actions must be exposed through scoped MCP tools, not generic execution interfaces. MCP is an open protocol for connecting AI applications to external tools and data, and the official TypeScript SDK provides the server foundation for implementing such tools.

### Initial tool set

| Tool | Purpose | Constraints |
|---|---|---|
| `get_customer_context` | Fetch lead stage, consent, recent messages, open handoff | Minimal safe data only |
| `upsert_lead` | Create or update qualified lead state | Requires schema validation and idempotency |
| `create_handoff` | Escalate conversation to human queue | Must pause autonomous flow |
| `search_catalog` | Search approved products/services | Approved business data only |
| `get_order_status` | Fetch order state after verification | Identity check required |
| `request_followup` | Create delayed follow-up request | Consent, timing, and duplicate rules required |

### MCP tool constraints

- Validate with Zod or equivalent schema layer.
- Authenticate tool caller.
- Verify organization, conversation, and contact relationship.
- Enforce policy before action execution.
- Return minimal safe output, not raw internal rows.
- Write audit event per tool call.
- Do not expose `run_sql`, arbitrary HTTP, unrestricted message send, or unrestricted delete tools.

## 3. LangGraph routing and policy gates

The orchestrator must be implemented as an explicit state graph, not a prompt-only autonomous loop. LangGraph supports durable execution, persistence, and human-in-the-loop patterns, which fits this application’s need for deterministic routing and escalations.

### Required top-level routes

- sales enquiry
- support / FAQ
- order status
- booking request
- human request
- opt-out
- unsafe / prohibited
- unknown / clarification required

### Routing flow

```text
START
  -> load_context
  -> classify_intent
  -> policy_check
      -> sales_flow
      -> support_flow
      -> order_flow
      -> booking_flow
      -> handoff_flow
      -> opt_out_flow
      -> unsafe_decline
      -> clarification
  -> response_quality_gate
      -> send_response
      -> escalate
  -> persist_outcome
END
```

### Policy requirements

- Complaint, refund, payment, legal, medical, or “human” requests escalate.
- No outbound re-engagement without recorded opt-in.
- No sensitive account/order disclosure without verification.
- No unsupported answer generation when retrieval confidence is low.
- No autonomous continuation after human takeover until resumed.

## 4. RAG quality layer

Customer-facing factual responses must be grounded in approved business content only. Supabase supports permission-aware RAG because pgvector is built on Postgres and can inherit access-control patterns.

### Knowledge sources

- product or service FAQs
- shipping and returns policy
- support policy
- business hours and location information
- appointment/eligibility rules
- approved brand/product descriptions

### Retrieval requirements

- Chunk documents and persist metadata by tenant.
- Retrieve only within tenant boundary.
- Require answer generation from retrieved context.
- Add confidence threshold.
- If confidence is below threshold or evidence is insufficient, ask clarifying question or escalate.
- Log retrieval source IDs used in each answer.

### Quality controls

- retrieval relevance dataset
- unsupported-question dataset
- contradictory-source tests
- no-answer fallback behavior
- grounded-answer rate tracking

## 5. QA and evaluation suite

This product must be built with a formal AI-QE mindset. The evaluation suite should validate correctness of routing, tool use, retrieval grounding, consent handling, and integration reliability.

### Mandatory evaluation dimensions

| Dimension | What must be tested |
|---|---|
| Intent correctness | message -> expected route |
| Tool selection | route -> expected tool/no tool |
| Grounding | response supported by retrieved source |
| Hallucination control | unsupported answers rejected or escalated |
| Tenant isolation | no cross-tenant data access |
| Webhook replay | duplicate inbound events produce one business action |
| Consent compliance | no follow-up when opted out or no consent |
| Handoff correctness | risky messages escalate with context |
| Policy adherence | unsafe/prohibited requests blocked |
| Integration resilience | retries, 429/5xx handling, timeouts |

### Test layers

- unit tests for schemas and business policies
- integration tests for API/webhooks/database/tool flows
- end-to-end tests for message-to-outcome workflows
- evaluation datasets for representative conversations
- regression suite on every release

## 6. Human handoff

When a human takes over, the platform must preserve the latest conversation summary, customer context, retrieved sources, and escalation reason. Automated replies must pause until the human resolves or explicitly returns control.

### Handoff triggers

- explicit user request for human
- complaint or refund
- payment/account issue
- legal/medical/safety issue
- repeated failure to clarify
- low confidence or unsupported answer
- integration or tool error

### Handoff requirements

- create handoff record with status and priority
- freeze automation except acknowledgement
- notify operator/owner
- preserve summary, latest messages, and route reason
- support resume or close action

## 7. Consent-safe re-engagement

Follow-ups, reorder reminders, booking reminders, and cart recovery must respect consent, approved templates, schedule rules, and deduplication. WhatsApp business messaging typically depends on approved template and messaging rules, and onboarding/platform setup must be aligned with official platform requirements.

### Re-engagement rules

- recorded opt-in required
- clear opt-out handling
- approved message template only
- deterministic idempotency key per send intent
- schedule windows and suppression rules
- duplicate prevention across retries and scheduler replays

### Sample workflows

- qualified lead no owner action after 24 hours
- appointment reminder 24 hours before slot
- reorder reminder after product-specific interval
- abandoned enquiry follow-up after configured delay

## 8. Vertical templates

Vertical templates must package the product into immediately useful workflows for SMBs.

### D2C skincare

- product finder
- FAQ support
- order status
- reorder reminder
- human beauty advisor handoff

### Salon / wellness

- service discovery
- appointment booking request
- reminder and reschedule
- staff handoff

### Coaching / education

- course enquiry qualification
- counsellor handoff
- reminder for demo or counselling call

### Home services

- serviceability capture
- quote lead qualification
- technician scheduling / handoff

## Integration Requirements

### WhatsApp integration

Use the official WhatsApp Business Platform via Cloud API and webhooks. Meta documents webhooks as the official mechanism for receiving business messaging events.

Requirements:
- webhook verification endpoint
- inbound message ingestion
- outbound message send service
- message status tracking
- retry logic and error handling
- idempotent processing of provider message IDs

### Embedded Signup

The platform must support business onboarding through Embedded Signup because it is Meta’s official onboarding flow for platform customers.

Requirements:
- launch signup flow from tenant onboarding UI
- capture returned business assets and identifiers
- persist per-tenant connection state
- support onboarding of existing WhatsApp Business app users when permitted

### Connectors

Initial connector roadmap:
- Shopify / WooCommerce
- Google Sheets / webhook export
- Freshdesk / Zoho Desk
- Google Calendar
- HubSpot / Zoho CRM later

## Non-Functional Requirements

### Security

- strict tenant isolation via RLS and server-side authorization
- secret storage server-side only
- audit trail for tool calls, outbound messages, handoffs, and admin actions
- no unrestricted agent access to system internals
- PII minimization and masking in logs where possible

### Data privacy and compliance

- Consent records are the system of record for messaging permission; automations must read from this table, never infer consent from message activity alone.
- Data retention and deletion: support tenant-initiated export and deletion of a contact's data on request, keeping only what audit/legal requirements demand.
- Where a tenant's customers are in India, treat contact data as personal data under the Digital Personal Data Protection Act and keep purpose limitation in mind when adding new automations that reuse stored contact data.
- Cross-border data handling and sub-processor list should be documented once a specific hosting/infra provider is finalized; this PRD does not assume a specific region.
- Role-based access: SMB owner, operator, and platform admin roles must have distinct permission scopes enforced server-side, not just hidden in the UI.

## Glossary

| Term | Meaning |
|---|---|
| Embedded Signup | Meta's official in-product flow for a business to connect its WhatsApp Business Account to a platform partner |
| Cloud API | Meta's hosted WhatsApp Business Platform messaging API |
| RLS | Row Level Security — Postgres feature restricting row access by policy, used here for tenant isolation |
| MCP | Model Context Protocol — open protocol for exposing tools/data to AI applications |
| RAG | Retrieval-Augmented Generation — generating answers grounded in retrieved source documents |
| Handoff | Transfer of a conversation from automated handling to a human operator |
| Grounded answer | A response whose factual content is traceable to retrieved, approved source documents |
| Dedup / idempotency key | A deterministic identifier used to prevent the same action (e.g. a reminder send) from happening twice |

### Reliability

- webhook ingestion path must respond quickly and process asynchronously
- retries with exponential backoff for outbound calls
- idempotency for inbound events and scheduled sends
- graceful fallback to handoff on degraded dependencies

### Performance

- message acknowledgement path under low latency
- acceptable end-to-end first response time for common flows
- retrieval latency low enough for conversational support

### Observability

- structured logs per conversation and tenant
- prompt/tool traces
- delivery and retry metrics
- evaluation metrics dashboard

## Suggested Technical Stack

| Concern | Recommended choice | Rationale |
|---|---|---|
| Frontend | Next.js + TypeScript | Familiar web platform and deployability |
| Backend | Fastify or Express + TypeScript | Strong control for webhooks and APIs |
| Database | Supabase Postgres | RLS, auth, vector, operational simplicity |
| Retrieval | pgvector in Supabase | Tenant-aware RAG foundation |
| Orchestration | LangGraph JS | Durable graph routing and HITL support |
| Tool layer | Custom MCP server in TypeScript | Safe business action exposure |
| Scheduling | pg_cron / Edge Functions initially; Temporal later | Start simple, scale workflow reliability later |
| Observability | Langfuse + application logs | AI traceability + ops visibility |
| Testing | Vitest + Playwright API/UI + evaluation datasets | Strong QA and E2E coverage |

## API / Service Boundaries

### Services

1. `gateway-api`
   - webhook verification
   - inbound event persistence
   - outbound messaging
   - delivery status updates

2. `agent-service`
   - LangGraph workflow execution
   - policy evaluation
   - response generation
   - tool request orchestration

3. `mcp-business-tools`
   - customer context
   - lead updates
   - handoff creation
   - follow-up requests
   - order / booking adapters

4. `scheduler-worker`
   - reminders and delayed sends
   - retry recovery
   - SLA timers

5. `evaluation-service`
   - offline datasets
   - regression scoring
   - grounded-answer metrics

## Suggested Repository Structure

```text
whatsapp-ai-smb-platform/
├── apps/
│   ├── gateway-api/
│   ├── agent-service/
│   └── operator-dashboard/
├── packages/
│   ├── mcp-business-tools/
│   ├── shared-types/
│   └── evaluation/
├── supabase/
│   ├── migrations/
│   ├── seeds/
│   └── functions/
├── knowledge-base/
│   ├── d2c-skincare/
│   ├── salon/
│   ├── coaching/
│   └── home-services/
├── tests/
│   ├── contract/
│   ├── integration/
│   ├── e2e/
│   └── evaluation/
├── docs/
│   ├── architecture.md
│   ├── threat-model.md
│   ├── quality-strategy.md
│   └── onboarding-runbook.md
└── README.md
```

## Milestones

| Phase | Deliverable | Exit criteria |
|---|---|---|
| 1 | Cloud API gateway + CRM base | inbound/outbound messaging works; tenant-safe entities exist |
| 2 | Lead qualification + handoff | structured lead capture and pause/resume handoff |
| 3 | RAG support | source-grounded FAQ responses with fallback |
| 4 | Consent-safe follow-up | scheduled reminders with dedup and opt-out checks |
| 5 | Vertical templates | at least one end-to-end vertical demo ready |
| 6 | Embedded Signup | SMB onboarding path usable end-to-end |
| 7 | Evaluation release | regression suite and quality metrics available |

## Success Metrics

Operational outcomes referenced in Goals must be measurable from day one so the evaluation-service and dashboard have concrete targets, not just directional claims.

| Metric | Definition | Where it's shown |
|---|---|---|
| First response time | Time from inbound message to first outbound reply (bot or human) | Overview dashboard |
| Lead capture rate | % of sales-routed conversations that reach a stored lead with required fields | Overview dashboard, Leads |
| Grounded-answer rate | % of support answers generated with retrieval confidence above threshold | Knowledge base, evaluation-service |
| Handoff rate | % of conversations escalated to a human | Handoff queue, Overview dashboard |
| Handoff SLA adherence | % of handoffs acknowledged within the configured SLA window | Handoff queue |
| Opt-out rate | % of contacts who opt out after receiving an automation | Automations |
| Duplicate-send rate | Automated sends blocked by idempotency/dedup vs. total attempted | Automations, audit log |
| Tenant isolation test pass rate | % of automated cross-tenant access tests passing per release | evaluation-service (internal, not customer-facing) |

Targets per vertical/tenant are configurable rather than hardcoded, since acceptable first-response time and handoff rate differ between, e.g., a solo salon owner and a multi-agent home-services team.

## Acceptance Criteria

The MVP is acceptable only when all of the following are true:

- A tenant can be onboarded and isolated from all other tenants.
- WhatsApp messages can be received, processed, and replied to using the official platform path.
- A sales enquiry can become a lead with stored context and owner notification.
- A support enquiry can be answered only from approved sources or safely escalated.
- A human handoff pauses automation and preserves context.
- A follow-up workflow sends only when consent and template rules allow it.
- Duplicate webhook deliveries do not create duplicate business actions.
- Evaluation suites cover routing, tools, grounding, consent, and tenant isolation.

## Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Cross-tenant leakage | Severe trust and compliance failure | RLS, server-side auth, tenant tests, audit review |
| Hallucinated support answers | Incorrect customer communication | source-only RAG, confidence gate, no-answer fallback |
| Duplicate sends | Customer annoyance and trust loss | idempotency keys, replay protection, scheduler dedup |
| Over-automation of sensitive cases | brand/compliance risk | handoff policy gates, category-based escalation |
| Integration downtime | delayed replies or broken workflows | retry, dead-letter handling, graceful escalation |
| SMB onboarding friction | poor activation | guided onboarding, vertical templates, Embedded Signup |

## Claude Code Build Path

The coding agent should use this build order:

1. Create the monorepo and base TypeScript tooling.
2. Implement Supabase schema with tenant isolation and RLS.
3. Implement WhatsApp gateway and webhook idempotency.
4. Implement first MCP tools: `get_customer_context`, `upsert_lead`, `create_handoff`.
5. Add LangGraph intent routing and policy gates.
6. Add RAG knowledge ingestion and retrieval guards.
7. Add human handoff workflow.
8. Add follow-up scheduler with consent and dedup logic.
9. Add evaluation datasets and regression tests.
10. Add one vertical template, preferably D2C skincare.
11. Add Embedded Signup onboarding flow.

## Folder / Path Recommendation for Claude Code

Recommended repository root path:

```text
whatsapp-ai-smb-platform/
```

Recommended PRD file path inside the repository:

```text
docs/prd/whatsapp-ai-smb-platform-prd.md
```

Recommended additional docs to create next:

```text
docs/architecture/system-architecture.md
docs/architecture/mcp-tools-spec.md
docs/architecture/langgraph-routing-spec.md
docs/architecture/rag-quality-spec.md
docs/qa/evaluation-strategy.md
docs/onboarding/smb-embedded-signup-flow.md
```

## Handoff Note for Claude Code

Use this PRD as the source document for scaffold generation. Build the system in a phased manner with TypeScript, Supabase, LangGraph, and a custom MCP server. Prefer explicit policies and typed contracts over prompt-only behavior. Do not implement unrestricted tools. Treat tenant isolation, auditability, grounded responses, and consent compliance as release-blocking requirements.
