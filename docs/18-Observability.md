# Observability & AI Evaluation Specification

## 1. LLM Tracing & Metrics
- Integrated with OpenTelemetry tracing spanning webhook ingestion, intent classification, policy evaluation, tool execution, and response generation.
- Tracks latency, prompt/completion token usage, and cost per tenant.

## 2. Evaluation Suite
- Built-in evaluation engine (`@business-os-ai/evaluation`) verifying:
  - Intent accuracy (target $\ge 90\%$)
  - Tool selection accuracy (target $\ge 90\%$)
  - Handoff compliance (target $\ge 95\%$)
  - Zero prohibited action violations (0 allowed)
