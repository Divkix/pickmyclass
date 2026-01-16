/**
 * BullMQ Queue Configuration
 *
 * Centralized configuration for queue names, job options, and worker settings.
 * Mirrors the settings from the previous Cloudflare Queue setup.
 */

import type { JobsOptions, WorkerOptions } from 'bullmq';

/**
 * Queue name constants
 */
export const QUEUE_NAMES = {
  /**
   * Main queue for class section checking
   */
  CLASS_CHECK: 'class-check-queue',

  /**
   * Dead letter queue for failed jobs after max retries
   */
  CLASS_CHECK_DLQ: 'class-check-dlq',
} as const;

/**
 * Default job options for class check jobs
 *
 * Matches previous Cloudflare Queue configuration:
 * - max_retries: 3
 * - Uses exponential backoff for retries
 */
export const DEFAULT_JOB_OPTIONS: JobsOptions = {
  /**
   * Number of retry attempts before moving to DLQ
   * Matches Cloudflare Queue max_retries: 3
   */
  attempts: 3,

  /**
   * Exponential backoff for retries
   * - 1st retry: 1 second
   * - 2nd retry: 2 seconds
   * - 3rd retry: 4 seconds
   */
  backoff: {
    type: 'exponential',
    delay: 1000,
  },

  /**
   * Remove completed jobs after 1 hour to save Redis memory
   */
  removeOnComplete: {
    age: 3600, // 1 hour in seconds
    count: 1000, // Keep at most 1000 completed jobs
  },

  /**
   * Keep failed jobs for 24 hours for debugging
   */
  removeOnFail: {
    age: 86400, // 24 hours in seconds
    count: 500, // Keep at most 500 failed jobs
  },
};

/**
 * Worker configuration
 *
 * Optimized for VPS with limited resources (1GB RAM, 1 OCPU)
 */
export const WORKER_CONFIG: Partial<WorkerOptions> = {
  /**
   * Number of concurrent jobs per worker
   * Reduced from 100 (Cloudflare) to 4 for VPS memory constraints
   */
  concurrency: 4,

  /**
   * Lock duration in milliseconds
   * How long a job can be processed before it's considered stalled
   * Set to 60 seconds to allow for slow scraper responses
   */
  lockDuration: 60000,

  /**
   * How often to check for stalled jobs (ms)
   */
  stalledInterval: 30000,

  /**
   * Maximum stalled count before job is considered failed
   */
  maxStalledCount: 2,
};
