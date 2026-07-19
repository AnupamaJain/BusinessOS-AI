# Meta Business Agent Integration Specification

## 1. Webhook Handshake Protocol
- **Verification Challenge Endpoint**: `GET /webhook`
  - Validates `hub.mode=subscribe` and `hub.verify_token`.
  - Returns `hub.challenge` as plain text with HTTP 200.

## 2. Inbound Message Payload Parsing
- Extract `entry[0].changes[0].value.messages[0]`
- Extract provider message ID `messages[0].id` for deduplication.
- Identify message type (`text`, `interactive`, `button`, `location`).

## 3. Outbound WhatsApp Message Dispatch
- **Endpoint**: `POST https://graph.facebook.com/v19.0/{phone_number_id}/messages`
- Supports interactive list messages and CTA quick reply buttons for package selection.
