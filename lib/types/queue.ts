/**
 * Cloudflare Queue Message Types
 *
 * Type definitions for queue messages used in parallel section processing.
 */

/**
 * Message sent to PICKMYCLASS_QUEUE for processing a single section
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
}
