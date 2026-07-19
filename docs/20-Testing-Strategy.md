# Testing Strategy & Quality Assurance

## 1. Multi-Layer Test Automation

```mermaid
graph TD
    UT[Unit Tests - Vitest] --> IT[Integration Tests - API & DB]
    IT --> ET[Evaluation Regression Suite - 30 Scenarios]
    ET --> E2E[End-to-End Simulation]
```

## 2. Test Execution Commands
- Unit Tests: `pnpm test`
- Integration Tests: `pnpm test:integration`
- Evaluation Suite: `pnpm test:eval`
