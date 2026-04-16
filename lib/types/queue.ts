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

  /**
   * Stagger group this section belongs to ('even' or 'odd')
   * Used for debugging and metrics
   */
  stagger_group: 'even' | 'odd';
}

import type { Env } from './env';

export type { Env };

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
