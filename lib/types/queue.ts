/**
 * Cloudflare Queue Message Types
 *
 * Type definitions for queue messages used in parallel section processing.
 */

/**
 * Message sent to CLASS_CHECK_QUEUE for processing a single section
 */
export interface ClassCheckMessage {
  /**
   * Section number to check (e.g., "12431")
   */
  class_nbr: string;

  /**
   * Term code (e.g., "2261" for Spring 2026)
   */
  term: string;

  /**
   * Timestamp when this message was enqueued
   */
  enqueued_at: string;

  /**
   * Stagger group this section belongs to ('even' or 'odd')
   * Used for debugging and metrics
   */
  stagger_group: 'even' | 'odd';
}

/**
 * Extended Cloudflare environment with queue bindings
 */
export interface Env extends Record<string, unknown> {
  // Existing bindings
  ASSETS: Fetcher;

  // Queue bindings
  CLASS_CHECK_QUEUE: Queue<ClassCheckMessage>;

  // Durable Object bindings
  CIRCUIT_BREAKER_DO: DurableObjectNamespace;
  CRON_LOCK_DO: DurableObjectNamespace;

  // Environment variables
  NEXT_PUBLIC_SUPABASE_URL: string;
  NEXT_PUBLIC_SUPABASE_ANON_KEY: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  SCRAPER_URL: string;
  SCRAPER_SECRET_TOKEN: string;
  RESEND_API_KEY?: string;
  NOTIFICATION_FROM_EMAIL?: string;
  CRON_SECRET: string;
  MAX_WATCHES_PER_USER?: string;
  SCRAPER_BATCH_SIZE?: string;
}

/**
 * Queue message batch received by consumer
 */
export interface QueueMessageBatch<T = ClassCheckMessage> {
  readonly queue: string;
  readonly messages: Array<QueueMessage<T>>;
}

/**
 * Individual queue message
 */
export interface QueueMessage<T = ClassCheckMessage> {
  readonly id: string;
  readonly timestamp: Date;
  readonly body: T;
  retry(): void;
  ack(): void;
}

/**
 * Result of processing a class section
 */
export interface ClassCheckResult {
  class_nbr: string;
  success: boolean;
  error?: string;
  changes_detected?: {
    seat_became_available?: boolean;
    instructor_assigned?: boolean;
  };
  emails_sent?: number;
  processing_time_ms?: number;
}
