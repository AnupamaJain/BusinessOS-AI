# Deployment Architecture Design

```mermaid
flowchart TD
    subgraph Edge["Cloudflare Edge Network"]
        WAF[WAF Rule Engine]
        DNS[Global DNS & SSL]
    end

    subgraph K8s["Production Kubernetes Cluster"]
        Ingress[Istio Ingress Gateway]
        GatewayAPI[gateway-api Deployment (3 Replicas)]
        Worker[scheduler-worker Deployment (2 Replicas)]
        Web[web Static Asset Deployment]
    end

    subgraph Data["Managed Database Cloud"]
        Supabase[(Supabase PostgreSQL HA)]
        Redis[(Redis Cluster Cache)]
    end

    Edge --> Ingress
    Ingress --> GatewayAPI
    Ingress --> Web
    GatewayAPI --> Redis
    GatewayAPI --> Supabase
    Worker --> Supabase
```
