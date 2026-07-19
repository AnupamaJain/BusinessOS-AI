# Low-Level Design (LLD)

## 1. Monorepo Package Boundaries

```
packages/
├── shared-types/        # Zod schemas, logger, constants, custom errors
├── config/              # Environment schema validation (Zod)
├── database/            # Supabase client factory, RLS helper assertions
├── auth/                # Session tokens, OAuth helpers, RBAC permission matrix
├── verticals/           # Vertical skill registry & Travel vertical definition
├── crm/                 # Lead qualification service & Contact deduplication
├── llm-gateway/         # Provider routing, fallback, latency & token cost tracking
├── mcp-business-tools/  # Scoped MCP tool functions & typed Zod schemas
└── agent-core/          # LangGraph state machine, intent router, policy engine, RAG
```

## 2. Inbound Message Processing LLD

```mermaid
sequenceDiagram
    participant WA as Meta Cloud API
    participant GW as Gateway API
    participant Agent as Agent Core
    participant Tools as MCP Tools
    participant DB as PostgreSQL

    WA->>GW: POST /webhook (Inbound Message)
    GW->>GW: Check Idempotency Key
    GW->>Agent: executeAgentGraph(state)
    Agent->>Agent: classifyIntent & evaluatePolicy
    Agent->>Tools: searchTravelPackages(params)
    Tools->>DB: Query packages filtered by organization_id
    DB-->>Tools: Package Records
    Tools-->>Agent: Catalog Matches
    Agent-->>GW: Formatted Response & Next State
    GW->>WA: POST /messages (WhatsApp Dispatch)
```
