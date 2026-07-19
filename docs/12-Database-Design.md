# Database Design Specification

## 1. Multi-Tenant Architecture Pattern
All 23 tables are tenant-isolated by `organization_id` foreign key referencing `organizations(id)` with `ON DELETE CASCADE`.

## 2. Table Directory

### Core SaaS Tables
1. `organizations` — Multi-tenant organization records
2. `organization_members` — Tenant members and roles (`owner`, `manager`, `sales_agent`, `support_agent`)
3. `contacts` — Customer directory
4. `consent_records` — Opt-in / Opt-out audit trails
5. `conversations` — Active chat sessions
6. `messages` — Message history & deduplication
7. `leads` — Qualified leads & scores
8. `handoffs` — Escalated human support tickets
9. `lead_activities` — Activity timeline
10. `automation_runs` — Scheduled campaign dispatches
11. `audit_events` — Immutable append-only audit trail
12. `integration_connections` — Provider OAuth connections
13. `knowledge_documents` — Document metadata
14. `knowledge_chunks` — pgvector 1536d chunk embeddings
15. `message_templates` — Approved Meta templates
16. `outbound_message_sends` — Message delivery status

### Travel Vertical Extension Tables (`20260720000001_travel_schema.sql`)
17. `destinations` — Travel destinations
18. `packages` — Holiday packages
    - Core fields: `sku`, `title`, `destination`, `duration_days`, `price_per_person`, `currency`, `inclusions`
19. `hotels` — Hotel accommodations
20. `flights` — Flight schedules
21. `bookings` — Travel package reservations
    - Core fields: `booking_number`, `package_sku`, `travel_date`, `traveler_count`, `total_amount`, `status` (`confirmed`, `pending`, `cancelled`)
22. `quotes` — Price estimates & itineraries
23. `itineraries` — Day-by-day travel plans
