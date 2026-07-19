# Scalability & Performance Tuning

## 1. High Concurrency Webhook Handling
- Asynchronous message worker decoupling HTTP response from LLM generation.
- Redis caching for organization settings, active session state, and vector embeddings.

## 2. Horizontal Scaling Strategy
- Stateless `gateway-api` pods auto-scaled via Kubernetes HPA.
- PostgreSQL read replicas for heavy analytics queries.
