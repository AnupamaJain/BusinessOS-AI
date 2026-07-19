/**
 * Shared constants for the WhatsApp AI SMB Platform.
 */

/** Maximum recent messages returned in customer context */
export const MAX_RECENT_MESSAGES = 10;

/** Default retrieval confidence threshold for RAG answers */
export const DEFAULT_RETRIEVAL_CONFIDENCE_THRESHOLD = 0.7;

/** Default embedding vector dimension (for OpenAI/Anthropic compatible embeddings) */
export const EMBEDDING_DIMENSION = 1536;

/** Allowed follow-up sending window (UTC hours) */
export const SEND_WINDOW = {
  startHour: 9,
  endHour: 21,
} as const;

/** Automation follow-up default delay in hours */
export const DEFAULT_FOLLOWUP_DELAY_HOURS = 24;

/** Lead score thresholds */
export const LEAD_SCORE = {
  MIN: 0,
  MAX: 100,
  QUALIFIED_THRESHOLD: 50,
} as const;
