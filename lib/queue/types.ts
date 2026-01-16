/**
 * BullMQ Queue Type Definitions
 *
 * Job types for the class-check queue.
 */

/**
 * Job data for class check processing
 *
 * Contains all information needed to check a single class section
 * and notify the user if seats become available.
 */
export interface ClassCheckJobData {
  /**
   * Section number to check (e.g., "12431")
   */
  classNbr: string;

  /**
   * Term code (e.g., "2261" for Spring 2026)
   */
  term: string;

  /**
   * Timestamp when this job was enqueued (ISO 8601)
   */
  enqueuedAt: string;

  /**
   * Stagger group this section belongs to ('even' or 'odd')
   * Used for debugging and metrics
   */
  staggerGroup: 'even' | 'odd';
}

/**
 * Job names for the class-check queue
 */
export type ClassCheckJobName = 'check-section';

/**
 * Result of a class check job
 */
export interface ClassCheckJobResult {
  /**
   * Whether the job completed successfully
   */
  success: boolean;

  /**
   * Section number that was checked
   */
  classNbr: string;

  /**
   * Whether seats became available
   */
  seatsAvailable?: boolean;

  /**
   * Number of notifications sent
   */
  notificationsSent?: number;

  /**
   * Error message if job failed
   */
  error?: string;
}

/**
 * Queue statistics returned by getJobCounts
 */
export interface QueueStats {
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
  paused: number;
}
