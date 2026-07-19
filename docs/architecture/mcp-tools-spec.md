# MCP Business Tools Specification

Model Context Protocol (MCP) tools provide a secure, standardized, and typed interface for the AI agent to execute business actions. These tools are strictly scoped, audited, and validated.

---

## 1. Safety Principles & Safeguards

The platform rejects generic, high-risk tools such as `run_sql`, `execute_arbitrary_http`, or `send_message_to_anyone`. Instead, all agent actions must satisfy:

1. **Strict Type Safety**: Every tool enforces a rigid, declarative Zod schema for inputs and outputs.
2. **Mandatory Tenant Scoping**: Every tool call requires an explicit `organization_id` parameter. The tool implementation validates that the contact and conversation belong to this organization BEFORE mutating or reading database data.
3. **Execution Auditing**: All tool executions write immutable audit entries containing the caller context, parameter logs, execution state, and correlation IDs.
4. **Consent Checks**: Tools related to schedules or campaign updates verify active user consent opt-ins.

---

## 2. Tool Directory & Schemas

### 1. `get_customer_context`
Loads CRM profile context, conversation logs, and active consent status for a customer.

- **Input Schema**:
  ```typescript
  const GetCustomerContextInput = z.object({
    organizationId: z.string().uuid(),
    contactId: z.string().uuid(),
  });
  ```
- **Output Schema**:
  ```typescript
  const GetCustomerContextOutput = z.object({
    contact: ContactSchema,
    recentMessages: z.array(MessageSchema),
    consentStatus: z.enum(['opt_in', 'opt_out', 'none']),
  });
  ```

### 2. `upsert_qualified_lead`
Captures or updates a customer lead record when lead-qualification conditions (e.g. lead score >= 50) are met.

- **Input Schema**:
  ```typescript
  const UpsertQualifiedLeadInput = z.object({
    organizationId: z.string().uuid(),
    contactId: z.string().uuid(),
    conversationId: z.string().uuid(),
    serviceInterest: z.string().max(500),
    qualificationSummary: z.string().max(1000),
    score: z.number().min(0).max(100),
    idempotencyKey: z.string(),
  });
  ```
- **Output Schema**:
  ```typescript
  const UpsertQualifiedLeadOutput = z.object({
    leadId: z.string().uuid(),
    stage: z.enum(['new', 'contacted', 'qualified', 'nurturing', 'lost']),
    isNew: z.boolean(),
  });
  ```

### 3. `create_human_handoff`
Creates an active operator handoff ticket and flags the conversation status to prevent automated agent interference.

- **Input Schema**:
  ```typescript
  const CreateHumanHandoffInput = z.object({
    organizationId: z.string().uuid(),
    contactId: z.string().uuid(),
    conversationId: z.string().uuid(),
    escalationReason: z.enum(['human_request', 'medical_claims_detected', 'complaint_or_refund', 'insufficient_grounding', 'unsafe_request', 'operator_intervention']),
    idempotencyKey: z.string(),
  });
  ```
- **Output Schema**:
  ```typescript
  const CreateHumanHandoffOutput = z.object({
    handoffId: z.string().uuid(),
    status: z.enum(['open', 'claimed', 'resolved']),
  });
  ```

### 4. `search_product_catalog`
Searches product inventory for specific skincare items by SKU, name, or ingredients.

- **Input Schema**:
  ```typescript
  const SearchProductCatalogInput = z.object({
    organizationId: z.string().uuid(),
    query: z.string().max(200),
    limit: z.number().int().min(1).max(10).optional(),
  });
  ```
- **Output Schema**:
  ```typescript
  const SearchProductCatalogOutput = z.object({
    products: z.array(ProductSchema),
  });
  ```

### 5. `request_followup_schedule`
Schedules a consent-safe 24-hour customer callback, reminder, or follow-up campaign automation.

- **Input Schema**:
  ```typescript
  const RequestFollowupScheduleInput = z.object({
    organizationId: z.string().uuid(),
    contactId: z.string().uuid(),
    conversationId: z.string().uuid(),
    templateKey: z.string().max(100),
    scheduledFor: z.string().datetime(), // ISO 8601 UTC
    idempotencyKey: z.string(),
  });
  ```
- **Output Schema**:
  ```typescript
  const RequestFollowupScheduleOutput = z.object({
    runId: z.string().uuid(),
    status: z.enum(['scheduled', 'completed', 'failed']),
    scheduledFor: z.string(),
  });
  ```

---

## 3. Tool Verification & Testing

Every tool implementation contains unit tests verifying:
- **Tenant scoping match**: Mismatched `organization_id` must throw `TenantAccessError`.
- **Idempotency**: Repeated requests with the same `idempotencyKey` return the original transaction record rather than generating duplicates.
- **Validation**: Schema-level validation rejects missing fields or incorrect data types immediately.
