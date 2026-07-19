# REST API Specifications

## 1. Gateway API Endpoints

### `GET /webhook`
Verification endpoint for Meta Cloud API webhook configuration.

### `POST /webhook`
Inbound webhook processor for WhatsApp, Instagram, and Messenger messages.

### `POST /internal/messages`
Send controlled outbound messages.
- **Request Body**:
  ```json
  {
    "organizationId": "11111111-1111-1111-1111-111111111111",
    "to": "+919876543210",
    "content": "Your Bali package booking BK-88219 is confirmed!"
  }
  ```

## 2. Platform Core Endpoints (Dashboard API)

- `GET /api/v1/conversations` — List tenant conversations with priority badges.
- `GET /api/v1/leads` — List qualified CRM leads and qualification scores.
- `GET /api/v1/packages` — Query travel package directory.
- `POST /api/v1/bookings` — Create a new holiday package booking.
- `POST /api/v1/handoffs/:id/resolve` — Mark escalated ticket resolved.
