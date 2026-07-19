# WhatsApp AI SMB Platform

A multi-tenant SaaS platform that helps small and medium businesses use WhatsApp for lead qualification, AI-powered support (RAG), CRM-backed context, human handoff, and consent-safe automation.

## Architecture

```
┌──────────────┐    ┌──────────────┐    ┌──────────────────┐
│  WhatsApp    │───▶│ Gateway API  │───▶│  Agent Service   │
│  Cloud API   │    │ (webhooks)   │    │  (LangGraph)     │
└──────────────┘    └──────────────┘    └────────┬─────────┘
                                                 │
                    ┌──────────────┐    ┌────────▼─────────┐
                    │  Operator    │    │  MCP Business    │
                    │  Dashboard   │    │  Tools           │
                    │  (Next.js)   │    └────────┬─────────┘
                    └──────┬───────┘             │
                           │            ┌────────▼─────────┐
                           └───────────▶│  Supabase        │
                                        │  (Postgres+RLS)  │
                    ┌──────────────┐    │  pgvector (RAG)  │
                    │  Scheduler   │───▶│  Auth            │
                    │  Worker      │    └──────────────────┘
                    └──────────────┘
```

## Tech Stack

- **Monorepo**: pnpm workspaces + Turborepo
- **Language**: TypeScript (strict mode)
- **Web App**: Next.js App Router
- **Backend**: Next.js route handlers (modular for Fastify extraction)
- **Database/Auth**: Supabase Postgres + Supabase Auth
- **Tenant Security**: Postgres Row Level Security (RLS)
- **Vector Retrieval**: Supabase pgvector
- **Agent Orchestration**: LangGraph JS
- **LLM Provider**: Anthropic (interface for OpenAI later)
- **MCP Server**: @modelcontextprotocol/sdk TypeScript SDK
- **Validation**: Zod
- **Testing**: Vitest + Playwright
- **Deploy**: Vercel (Next.js) + Supabase (data/auth/functions)

## Project Structure

```
whatsapp-ai-smb-platform/
├── apps/
│   ├── web/                    # Next.js operator dashboard
│   ├── gateway-api/            # WhatsApp webhook service
│   ├── agent-service/          # LangGraph execution service
│   └── scheduler-worker/       # Scheduled follow-ups/reminders
├── packages/
│   ├── shared-types/           # Zod schemas, DTOs, constants
│   ├── database/               # Supabase clients, RLS helpers
│   ├── config/                 # tsconfig, env validation
│   ├── mcp-business-tools/     # MCP server + business tools
│   ├── agent-core/             # LangGraph state, nodes, policies
│   ├── integrations/           # WhatsApp, Shopify, calendar adapters
│   └── evaluation/             # Datasets, scorers, regression tests
├── supabase/
│   ├── migrations/             # SQL schema + RLS policies
│   ├── seed.sql                # Demo data (GlowRoot Skincare)
│   └── functions/              # Edge functions
├── knowledge-base/
│   └── d2c-skincare/           # GlowRoot product/policy content
├── tests/                      # Contract, integration, e2e, evaluation
├── docs/                       # Architecture, threat model, QA strategy
└── reports/                    # Test reports (gitignored)
```

## Local Setup

### Prerequisites

- Node.js 20+
- pnpm 9+
- Supabase CLI (for local database)

### Installation

```bash
# Clone the repository
git clone <repo-url>
cd whatsapp-ai-smb-platform

# Install dependencies
pnpm install

# Copy environment variables
cp .env.example .env
# Edit .env with your local Supabase credentials

# Start local Supabase (if using Supabase CLI)
supabase start

# Run migrations
supabase db reset

# Run tests
pnpm test
```

### Commands

| Command | Description |
|---------|-------------|
| `pnpm install` | Install all dependencies |
| `pnpm build` | Build all packages |
| `pnpm dev` | Start dev servers |
| `pnpm lint` | Run linting |
| `pnpm typecheck` | Run TypeScript type checking |
| `pnpm test` | Run unit tests |
| `pnpm test:integration` | Run integration tests |
| `pnpm test:e2e` | Run end-to-end tests |
| `pnpm test:eval` | Run AI evaluation tests |
| `pnpm test:all` | Run all test suites |

## Environment Variables

See [.env.example](.env.example) for all required and optional variables. Key variables:

| Variable | Required | Description |
|----------|----------|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | Supabase anonymous key |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Supabase service role key |
| `ANTHROPIC_API_KEY` | Yes | Anthropic API key for LLM |
| `META_*` | Yes | Meta/WhatsApp Business credentials |
| `ENABLE_MOCK_WHATSAPP` | No | Use mock WhatsApp adapter (default: true) |
| `ENABLE_DRY_RUN_AUTOMATION` | No | Dry-run scheduled sends (default: true) |

## Demo Flow

### GlowRoot Skincare (D2C Vertical)

**Flow 1: Product Enquiry → Lead Qualification**
```
Customer: "I need a sunscreen for oily skin."
→ Detect sales enquiry intent
→ Load CRM/customer context
→ Retrieve from GlowRoot knowledge base
→ Recommend AquaShield SPF 50 (approved product data only)
→ Capture interest, qualify lead
→ Offer human handoff
```

**Flow 2: Refund Request → Human Handoff**
```
Customer: "I want a refund. Connect me to a person."
→ Detect complaint/refund + human request
→ Create high-priority handoff
→ Pause bot automation
→ Send acknowledgement only
→ Store summary and context for human agent
```

## Security Model

- **Tenant Isolation**: Every table has `organization_id` with RLS policies
- **Server-side Authorization**: Membership verified before any data access
- **No Unrestricted Tools**: All agent actions are typed, scoped, and audited
- **Append-only Audit Trail**: `audit_events` table prevents UPDATE/DELETE
- **Policy Engine**: Deterministic TypeScript functions, not prompt-based

## Implementation Status

See [docs/implementation-status.md](docs/implementation-status.md) for current progress.

## License

Proprietary — All rights reserved.
