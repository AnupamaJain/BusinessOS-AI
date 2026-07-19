/**
 * Webhook idempotency service.
 * Deduplicates inbound webhook events by provider_message_id.
 * Uses an in-memory set for MVP; designed for database-backed dedup later.
 */
export class IdempotencyService {
  private readonly processedIds: Set<string> = new Set();

  /**
   * Check if a provider message ID has already been processed.
   * Returns true if this is the first time (should process).
   * Returns false if duplicate (should skip).
   */
  tryAcquire(providerMessageId: string): boolean {
    if (this.processedIds.has(providerMessageId)) {
      return false;
    }
    this.processedIds.add(providerMessageId);
    return true;
  }

  /** Check if an ID was already processed. */
  isProcessed(providerMessageId: string): boolean {
    return this.processedIds.has(providerMessageId);
  }

  /** Clear all tracked IDs (for testing). */
  clear(): void {
    this.processedIds.clear();
  }

  /** Get count of processed IDs. */
  get size(): number {
    return this.processedIds.size;
  }
}
