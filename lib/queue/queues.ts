/**
 * BullMQ Queue Instances
 *
 * Provides singleton Queue instances and helper functions for job management.
 * Uses Redis connection configuration from environment.
 *
 * NOTE: BullMQ bundles its own ioredis, so we cannot share the ioredis instance
 * from lib/redis/client.ts directly. Instead, we parse REDIS_URL and pass
 * connection options.
 */

import { type ConnectionOptions, Queue } from 'bullmq';
import { DEFAULT_JOB_OPTIONS, QUEUE_NAMES } from './config';
import type { ClassCheckJobData, QueueStats } from './types';

/**
 * Parse REDIS_URL into connection options for BullMQ
 *
 * Handles both redis:// and rediss:// (TLS) URLs
 */
function getConnectionOptions(): ConnectionOptions {
  const redisUrl = process.env.REDIS_URL;

  if (!redisUrl) {
    throw new Error(
      'REDIS_URL is not set in environment variables. ' +
        'Expected format: redis://user:pass@host:port or rediss://... for TLS'
    );
  }

  const url = new URL(redisUrl);
  const isTls = url.protocol === 'rediss:';

  return {
    host: url.hostname,
    port: Number.parseInt(url.port, 10) || 6379,
    password: url.password || undefined,
    username: url.username || undefined,
    tls: isTls ? {} : undefined,
    // BullMQ requires this to be null for proper blocking operations
    maxRetriesPerRequest: null,
  };
}

/**
 * Singleton instance for the class check queue
 * Using generic Queue type to avoid BullMQ's complex type inference
 */
let classCheckQueue: Queue<ClassCheckJobData, unknown, string> | null = null;

/**
 * Get or create the class-check queue singleton
 *
 * Uses lazy initialization to avoid connection on import.
 *
 * @returns BullMQ Queue instance for class checking
 *
 * @example
 * const queue = getClassCheckQueue();
 * await queue.add('check-section', { classNbr: '12431', ... });
 */
export function getClassCheckQueue(): Queue<ClassCheckJobData, unknown, string> {
  if (classCheckQueue) {
    return classCheckQueue;
  }

  const connection = getConnectionOptions();

  classCheckQueue = new Queue<ClassCheckJobData, unknown, string>(QUEUE_NAMES.CLASS_CHECK, {
    connection,
    defaultJobOptions: DEFAULT_JOB_OPTIONS,
  });

  console.log(`[Queue] Initialized ${QUEUE_NAMES.CLASS_CHECK} queue`);

  return classCheckQueue;
}

/**
 * Enqueue multiple class check jobs in bulk
 *
 * More efficient than adding jobs one by one.
 *
 * @param jobs - Array of job data
 * @returns Array of created jobs
 *
 * @example
 * await enqueueClassCheckBulk([
 *   { classNbr: '12431', term: '2261', ... },
 *   { classNbr: '12432', term: '2261', ... },
 * ]);
 */
export async function enqueueClassCheckBulk(jobs: ClassCheckJobData[]) {
  try {
    const queue = getClassCheckQueue();

    const bulkJobs = jobs.map((job) => ({
      name: 'check-section' as const,
      data: job,
      opts: {
        jobId: `${job.term}-${job.classNbr}`,
      },
    }));

    const createdJobs = await queue.addBulk(bulkJobs);

    console.log(`[Queue] Bulk enqueued ${createdJobs.length} jobs`);

    return createdJobs;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[Queue] Error bulk enqueueing ${jobs.length} jobs: ${errorMsg}`);
    throw error;
  }
}

/**
 * Get queue statistics (job counts by status)
 *
 * Useful for health checks and monitoring.
 *
 * @returns Object with counts for each job status
 *
 * @example
 * const stats = await getQueueStats();
 * console.log(`Waiting: ${stats.waiting}, Active: ${stats.active}`);
 */
export async function getQueueStats(): Promise<QueueStats> {
  try {
    const queue = getClassCheckQueue();

    const counts = await queue.getJobCounts(
      'waiting',
      'active',
      'completed',
      'failed',
      'delayed',
      'paused'
    );

    return {
      waiting: counts.waiting ?? 0,
      active: counts.active ?? 0,
      completed: counts.completed ?? 0,
      failed: counts.failed ?? 0,
      delayed: counts.delayed ?? 0,
      paused: counts.paused ?? 0,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[Queue] Error getting queue stats: ${errorMsg}`);
    // Return zeros on error to not break health checks
    return {
      waiting: 0,
      active: 0,
      completed: 0,
      failed: 0,
      delayed: 0,
      paused: 0,
    };
  }
}

/**
 * Close queue connections gracefully
 *
 * Should be called during application shutdown.
 *
 * @example
 * process.on('SIGTERM', async () => {
 *   await closeQueues();
 * });
 */
export async function closeQueues(): Promise<void> {
  const errors: Error[] = [];

  if (classCheckQueue) {
    try {
      console.log('[Queue] Closing class-check queue...');
      await classCheckQueue.close();
      console.log('[Queue] Class-check queue closed');
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      console.error(`[Queue] Error closing class-check queue: ${errorMsg}`);
      if (error instanceof Error) errors.push(error);
    } finally {
      classCheckQueue = null;
    }
  }

  if (errors.length > 0) {
    console.error(`[Queue] ${errors.length} error(s) during queue shutdown`);
  } else {
    console.log('[Queue] All queues closed');
  }
}

/**
 * Get connection options for external use (e.g., by Workers)
 *
 * Workers need to create their own connection, this provides
 * the same connection options.
 */
export { getConnectionOptions };
