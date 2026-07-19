# High-Level Architecture Design (HLD)

```mermaid
flowchart TD
    subgraph Channels["External Channels"]
        WA[WhatsApp Business API]
        IG[Instagram Messaging]
        FB[Facebook Messenger]
    end

    subgraph Edge["Edge & Security Layer"]
        CF[Cloudflare WAF]
        GW[Gateway API - Express.js]
    end

    subgraph Core["BusinessOS AI Platform Core"]
        Auth[Auth & RBAC Service]
        Coord[Coordinator Agent / LangGraph]
        LLM[LLM Gateway - Multi Provider]
        MCP[MCP Business Tools Store]
        RAG[Grounded RAG Search]
    end

    subgraph Data["Persistence Layer"]
        PG[(PostgreSQL HA + pgvector)]
        RLS[Supabase RLS Enforcer]
        Audit[(Append-Only Audit Events)]
    end

    subgraph UI["Operator Workspace"]
        Web[React + Vite Web Dashboard]
    end

    WA -->|Webhook| CF --> GW
    IG -->|Webhook| CF --> GW
    FB -->|Webhook| CF --> GW

    GW --> Auth
    GW --> Coord
    Coord --> LLM
    Coord --> RAG
    Coord --> MCP
    MCP --> RLS --> PG
    MCP --> Audit
    Web --> GW
```
