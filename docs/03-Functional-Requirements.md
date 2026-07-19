# Functional Requirements Specification

## 1. Gateway API & Webhook Module
- `GET /webhook`: Verify Meta Cloud API webhook subscription challenge tokens.
- `POST /webhook`: Process inbound Meta messages, deduplicate by `provider_message_id`, and dispatch to agent workflow.
- `POST /internal/messages`: Controlled outbound messaging endpoint.

## 2. Agent Core & Intent Classification
- Classifies incoming messages into explicit intent categories (`package_inquiry`, `support_question`, `booking_request`, `complaint_or_refund`, `opt_out`, `unsafe_request`).
- Evaluates deterministic safety policies prior to tool execution or response dispatch.

## 3. RAG Retrieval & Knowledge Base
- Ingests markdown files (`travel-packages.md`, `visa-and-cancellation-policy.md`).
- Generates 1536-dimensional vector embeddings and performs cosine similarity search filtered by `organization_id`.
- Triggers human handoff when match score is below grounding threshold ($0.85$).

## 4. Operator Dashboard Web App
- React + Vite + TypeScript web application with CSS styling.
- Operator inbox queue to claim, reply, and resolve escalated tickets.
- CRM leads database table and holiday packages directory searcher.
- Campaign scheduler and AI compliance gauges.
