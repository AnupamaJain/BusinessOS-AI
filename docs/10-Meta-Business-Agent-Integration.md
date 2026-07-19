# Meta Business Agent Integration Specification

## 1. Webhook Handshake Protocol
- **Verification Challenge Endpoint**: `GET /webhook`
- Validates `hub.mode=subscribe` and `hub.verify_token`.
- Returns `hub.challenge` as plain text with HTTP 200.

## 2. Inbound Message Payload Parsing
- Extract `entry[0].changes[0].value.messages[0]`
- Extract provider message ID `messages[0].id` for deduplication.
- Identify message type (`text`, `interactive`, `button`, `location`).

## 3. Native Meta AI Agents (Metadata Routing)
- **Concept**: Meta AI native agents can handle basic conversational inquiries. When they encounter tasks outside their abilities (e.g. executing bookings, checking inventory, processing payments), they hand off the thread via webhook to our platform.
- **Payload Extraction**:
  - Webhooks from Native AI agents will include `metadata` objects in the payload.
  - The `apps/gateway-api` webhook parser routes these specific payloads to the `@business-os-ai/agent-core` (the SaarthiOne Coordinator Agent), preserving the Meta AI `metadata`.
  - The SaarthiOne Coordinator Agent acts as a specialized backend solver for the Meta Native Agent.

## 4. Outbound WhatsApp Message Dispatch
- **Endpoint**: `POST https://graph.facebook.com/v19.0/{phone_number_id}/messages`
- Supports interactive list messages and CTA quick reply buttons for package selection.

