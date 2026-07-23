# Agentic AI Architecture Specification

## 1. Multi-Agent Coordinator & Specialist Mesh

```mermaid
graph TD
    User[Customer Inbound] --> Coord[Coordinator Agent]
    
    Coord -->|Inquiry / Lead| Sales[Sales Agent · 3.4x Conv]
    Coord -->|Support / Policy| Support[Support Agent · <2s Res]
    Coord -->|Reservation| Booking[Booking Agent · Zero Double-Book]
    Coord -->|Broadcast / Offer| Marketing[Marketing Agent · 68% Open Rate]
    Coord -->|Payment / Tax| Finance[Finance Agent · GST Invoices]
    Coord -->|Itinerary| Travel[Travel Agent · Concierge]

    Sales --> MCP[MCP Business Tools]
    Support --> RAG[Grounded RAG Search]
    Booking --> MCP
    Marketing --> Scheduler[Scheduler Worker]
    Finance --> Gateway[Razorpay Payment Gateway]
    Travel --> MCP
```

## 2. Agent Responsibilities & Benchmark SLA Matrix

| Agent Name | Avatar & SLA Benchmark | Primary Responsibility | Key Tools & Infrastructure |
|------------|------------------------|------------------------|----------------------------|
| **Coordinator Agent** | 🧭 Meta/WhatsApp Ingress | Intent classification, routing & state preservation | Intent Classifier, Vertical Registry |
| **Sales Agent** | 💼 3.4x Lead Conv | Lead qualification, quote generation & instant lock | `upsert_qualified_lead`, `search_travel_packages` |
| **Support Agent** | 🎧 < 2-sec Resolution | 24/7 policy search, visa/refund Q&A & human escalation | `create_human_handoff`, Vector RAG Search |
| **Booking Agent** | 📅 Zero Double-Bookings | Slot selection, reservation lock & appointment tokens | `create_travel_booking`, `getOrderStatus` |
| **Marketing Agent** | 📢 68% WA Open Rate | Re-engagement campaigns, promo codes & consent checks | `request_followup_schedule`, Scheduler Worker |
| **Finance Agent** | 💳 ₹74k Recovered / mo | Payment links, official GST tax invoice PDFs & refunds | `RazorpayPaymentService`, Webhook Listener |
| **Travel Agent** | 🌴 Concierge Plans | Customized day-by-day trip planning & vouchers | `search_travel_packages`, Itinerary Builder |

---

## 3. OpenMontage AI Video & Multi-Modal Media Engine

SaarthiOne integrates the **OpenMontage** pipeline pattern (`calesthio/OpenMontage`) for automated AI video generation, motion clip rendering, and voiceover production:

- **AI Video Providers**: Fal.ai (FLUX / Veo / Kling / MiniMax), Replicate (Seedance / Wan2.1), Kling AI direct API.
- **Stock Media Sourcing**: Pexels, Pixabay, Unsplash, Archive.org.
- **AI Voice & Music**: ElevenLabs, Google Cloud TTS, Suno AI music.
- **Agent Integration**: `generate_promo_media` MCP tool exposed to Marketing & Travel Agents for generating in-thread video teasers and campaign reels.


