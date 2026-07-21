/**
 * BusinessStore — async persistence contract used by all MCP business tools,
 * the agent graph, and the scheduler.
 *
 * Two implementations:
 *  - ToolDataStore (in-memory, tests/evaluation) in tools.ts
 *  - SupabaseBusinessStore (production, Postgres via Supabase) in supabase-store.ts
 */

export interface ContactRecord { id: string; organizationId: string; phone: string; name?: string; email?: string; tags?: string[]; preferredLanguage?: string; lastSeenAt?: string; }
export interface ContactNote { id: string; contactId: string; kind: 'memory' | 'note'; body: string; createdAt: string; }
export interface ConsentRow { contactId: string; organizationId: string; consentType: string; action: string; }
export interface LeadRecord { id: string; organizationId: string; contactId: string; conversationId: string; stage: string; serviceInterest: string; budgetRange?: string; purchaseTimeline?: string; qualificationSummary?: string; score?: number; idempotencyKey: string; }
export interface HandoffRecord { id: string; organizationId: string; conversationId: string; contactId: string; reason: string; priority: string; status: string; summary: string; idempotencyKey: string; }
export interface MessageRecord { direction: string; content: string; createdAt: string; organizationId: string; conversationId: string; messageType?: string; providerMessageId?: string; }
export interface AuditEventRecord { id: string; organizationId: string; action: string; entityType: string; entityId: string; actorType: string; details: Record<string, unknown>; createdAt: string; }
export interface AutomationRunRecord { id: string; organizationId: string; contactId: string; conversationId: string; templateKey: string; campaignType: string; idempotencyKey: string; status: string; scheduledFor: string; }
export interface ConversationRecord { id: string; organizationId: string; status: string; contactId?: string; }
export interface ProductRecord { sku: string; name: string; price: string; skinType: string; description: string; suitableFor: string; organizationId: string; }
export interface TemplateRecord { templateKey: string; organizationId: string; status: string; name?: string; content?: string; }
export interface OrderRecord { id: string; organizationId: string; contactId: string; orderNumber: string; status: string; totalAmount: string; items: string; estimatedDelivery: string; }
export interface PackageRecord { sku: string; title: string; destination: string; durationDays: number; pricePerPerson: number; currency: string; inclusions: string[]; organizationId: string; metadata?: Record<string, unknown>; }
export interface BookingRecord { id: string; organizationId: string; contactId: string; bookingNumber: string; packageSku: string; travelDate: string; travelerCount: number; totalAmount: number; status: string; metadata?: Record<string, unknown>; }

/** Live business snapshot for the owner-facing assistant. */
export interface BusinessSummary {
  todayEnquiries: number;
  hotLeads: number;
  qualifiedLeads: number;
  pendingPayments: number;
  staleLeads: number;
  pipelineText: string;
  topHotLeads: Array<{ name?: string; serviceInterest: string; score?: number }>;
  staleContacts: Array<{ contactId: string; phone?: string; name?: string; serviceInterest: string; lastActivity: string }>;
}

/** A per-organization WhatsApp connection created via Embedded Signup. */
export interface WhatsAppConnection {
  organizationId: string;
  wabaId?: string;
  phoneNumberId: string;
  displayPhoneNumber?: string;
  accessToken: string;
}

/**
 * A per-organization payment gateway connection. Each merchant connects their
 * OWN Razorpay account. `keySecret` / `webhookSecret` are the DECRYPTED plaintext
 * at this type boundary; they are stored encrypted at rest.
 */
export interface PaymentConnection {
  organizationId: string;
  provider: string;
  keyId: string;
  keySecret: string;
  webhookSecret?: string;
  mode?: 'test' | 'live';
  status: string;
}

export interface BusinessStore {
  /** Owner WhatsApp numbers (E.164) allowed to use the owner assistant. */
  getOwnerPhoneNumbers(organizationId: string): Promise<string[]>;
  /** Resolve which org + credentials own a given WhatsApp phone_number_id. */
  getWhatsAppConnectionByPhoneId(phoneNumberId: string): Promise<WhatsAppConnection | null>;
  /** Store (upsert) an org's WhatsApp connection after Embedded Signup. */
  saveWhatsAppConnection(conn: WhatsAppConnection & { connectedBy?: string; verifiedName?: string }): Promise<void>;

  /** Resolve an org's payment connection with decrypted secrets, or null. */
  getPaymentConnection(organizationId: string): Promise<PaymentConnection | null>;
  /** Store (upsert) an org's per-merchant payment credentials (secrets encrypted at rest). */
  savePaymentConnection(organizationId: string, input: { keyId: string; keySecret: string; webhookSecret?: string; mode?: 'test' | 'live' }): Promise<void>;

  /** Aggregate business metrics for the owner briefing. */
  getBusinessSummary(organizationId: string, now: Date): Promise<BusinessSummary>;

  // Contacts & consent
  findContactById(organizationId: string, contactId: string): Promise<ContactRecord | undefined>;
  findContactByPhone(organizationId: string, phone: string): Promise<ContactRecord | undefined>;
  upsertContactByPhone(organizationId: string, phone: string, name?: string): Promise<ContactRecord>;
  listConsent(organizationId: string, contactId: string): Promise<ConsentRow[]>;
  insertConsent(row: ConsentRow & { source?: string }): Promise<void>;

  // Business Brain — per-customer memory + notes, engagement recency
  /** Append a memory (AI fact) or operator note. Memories are deduped on exact body per contact. */
  addContactNote(organizationId: string, input: { contactId: string; kind: 'memory' | 'note'; body: string; createdBy?: string }): Promise<void>;
  /** All notes for a contact, newest first. */
  getContactNotes(organizationId: string, contactId: string): Promise<ContactNote[]>;
  /** Stamp the contact's last_seen_at to now. */
  updateContactLastSeen(organizationId: string, contactId: string): Promise<void>;

  // Leads
  latestLeadForContact(organizationId: string, contactId: string): Promise<LeadRecord | undefined>;
  findLeadByIdempotencyKey(organizationId: string, idempotencyKey: string): Promise<LeadRecord | undefined>;
  insertLead(lead: LeadRecord): Promise<LeadRecord>;
  updateLead(organizationId: string, leadId: string, patch: Partial<LeadRecord>): Promise<void>;

  // Conversations & messages
  getConversation(organizationId: string, conversationId: string): Promise<ConversationRecord | undefined>;
  findOrCreateActiveConversation(organizationId: string, contactId: string): Promise<ConversationRecord>;
  updateConversationStatus(organizationId: string, conversationId: string, status: string): Promise<void>;
  listRecentMessages(organizationId: string, conversationId: string, limit: number): Promise<MessageRecord[]>;
  insertMessage(message: MessageRecord): Promise<void>;

  // Handoffs
  findOpenHandoff(organizationId: string, conversationId: string): Promise<HandoffRecord | undefined>;
  findHandoffByIdempotencyKey(organizationId: string, idempotencyKey: string): Promise<HandoffRecord | undefined>;
  insertHandoff(handoff: HandoffRecord): Promise<HandoffRecord>;

  // Audit
  insertAuditEvent(event: AuditEventRecord): Promise<void>;

  // Automation
  findAutomationRunByIdempotencyKey(organizationId: string, idempotencyKey: string): Promise<AutomationRunRecord | undefined>;
  insertAutomationRun(run: AutomationRunRecord): Promise<AutomationRunRecord>;
  listDueAutomationRuns(now: Date): Promise<AutomationRunRecord[]>;
  updateAutomationRun(organizationId: string, runId: string, patch: Partial<AutomationRunRecord>): Promise<void>;

  // Catalog & orders
  searchProducts(organizationId: string, query: string, filters?: { skinType?: string; concern?: string }): Promise<ProductRecord[]>;
  findTemplate(organizationId: string, templateKey: string): Promise<TemplateRecord | undefined>;
  findOrderByNumber(organizationId: string, contactId: string, orderNumber: string): Promise<OrderRecord | undefined>;

  // Travel
  searchPackages(organizationId: string, filters?: { destination?: string; maxBudgetPerPerson?: number; durationDays?: number }): Promise<PackageRecord[]>;
  insertBooking(booking: Omit<BookingRecord, 'id' | 'bookingNumber' | 'status'>): Promise<BookingRecord>;

  // Generic verticals (cab, home-services, …) — packages selected by metadata->>'type'
  getPackagesByType(organizationId: string, type: string): Promise<PackageRecord[]>;
}
