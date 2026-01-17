/**
 * Class Check Cron Handler
 *
 * Handles the periodic class check job that enqueues sections to BullMQ.
 * Ported from app/api/cron/route.ts to work with node-cron scheduler.
 *
 * Schedule: Every 30 minutes (0,30 * * * *)
 * - :00 minutes -> Even class numbers (0, 2, 4, 6, 8)
 * - :30 minutes -> Odd class numbers (1, 3, 5, 7, 9)
 */

import { getSectionsToCheck } from '@/lib/db/queries';
import { enqueueClassCheckBulk } from '@/lib/queue/queues';
import type { ClassCheckJobData } from '@/lib/queue/types';
import { type AcquireLockResult, acquireLock, releaseLock } from '@/lib/redis/cron-lock';

const LOCK_RETRY_CONFIG = {
  maxAttempts: 10,
  initialDelayMs: 5000,
  maxDelayMs: 60000,
  backoffMultiplier: 1.5,
  maxTotalTimeMs: 5 * 60 * 1000, // 5 minutes
} as const;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function acquireLockWithRetry(): Promise<AcquireLockResult> {
  const startTime = Date.now();
  let lastResult: AcquireLockResult | null = null;

  for (let attempt = 1; attempt <= LOCK_RETRY_CONFIG.maxAttempts; attempt++) {
    if (Date.now() - startTime >= LOCK_RETRY_CONFIG.maxTotalTimeMs) {
      return lastResult || { acquired: false, message: 'Lock acquisition timed out' };
    }

    const result = await acquireLock();
    lastResult = result;

    if (result.acquired) {
      if (attempt > 1) console.log(`[Cron] Lock acquired on attempt ${attempt}`);
      return result;
    }

    if (attempt < LOCK_RETRY_CONFIG.maxAttempts) {
      const delay = Math.min(
        LOCK_RETRY_CONFIG.initialDelayMs * LOCK_RETRY_CONFIG.backoffMultiplier ** (attempt - 1),
        LOCK_RETRY_CONFIG.maxDelayMs
      );
      console.log(`[Cron] Lock held, retrying in ${delay}ms (attempt ${attempt})`);
      await sleep(delay);
    }
  }

  return lastResult || { acquired: false, message: 'Max retry attempts reached' };
}

/**
 * Result of a cron run
 */
export interface CronRunResult {
  success: boolean;
  sectionsEnqueued: number;
  staggerGroup: 'even' | 'odd';
  durationMs: number;
  error?: string;
}

/**
 * Run the class check cron job
 *
 * This function:
 * 1. Acquires a distributed lock to prevent concurrent runs
 * 2. Determines the stagger group based on current time
 * 3. Fetches sections to check from database
 * 4. Enqueues all sections to BullMQ for processing
 * 5. Releases the lock when done
 *
 * @returns Result of the cron run
 *
 * @example
 * const result = await runClassCheckCron();
 * if (result.success) {
 *   console.log(`Enqueued ${result.sectionsEnqueued} sections`);
 * }
 */
export async function runClassCheckCron(): Promise<CronRunResult> {
  const startTime = Date.now();
  const timestamp = new Date().toISOString();
  let lockAcquired = false;
  let lockId: string | undefined;

  console.log(`[Cron] Starting cron run at ${timestamp}`);

  try {
    // Acquire distributed lock to prevent concurrent cron runs (with retry)
    const lockResult = await acquireLockWithRetry();

    if (!lockResult.acquired) {
      console.warn(`[Cron] Lock acquisition failed at ${timestamp}: ${lockResult.message}`);
      return {
        success: false,
        sectionsEnqueued: 0,
        staggerGroup: determineStaggerGroup(),
        durationMs: Date.now() - startTime,
        error: `Another cron job is already running: ${lockResult.message}`,
      };
    }

    lockAcquired = true;
    lockId = lockResult.lockHolder;
    console.log(`[Cron] Lock acquired successfully (holder: ${lockId})`);

    // Determine stagger group based on current time
    // :00 -> even, :30 -> odd
    const staggerGroup = determineStaggerGroup();

    console.log(
      `[Cron] Starting 30-minute class check (stagger: ${staggerGroup}, time: ${timestamp})`
    );

    // Fetch sections to check from database
    let sections: Awaited<ReturnType<typeof getSectionsToCheck>>;
    try {
      sections = await getSectionsToCheck(staggerGroup);
    } catch (dbError) {
      const errorMsg = dbError instanceof Error ? dbError.message : 'Unknown error';
      console.error(`[Cron] Database error fetching sections: ${errorMsg}`);
      throw dbError;
    }

    console.log(`[Cron] Found ${sections.length} sections to check (stagger: ${staggerGroup})`);

    // Handle case with no sections
    if (sections.length === 0) {
      console.log(`[Cron] No sections to check for stagger group: ${staggerGroup}`);
      return {
        success: true,
        sectionsEnqueued: 0,
        staggerGroup,
        durationMs: Date.now() - startTime,
      };
    }

    // Convert sections to job data format
    const jobs: ClassCheckJobData[] = sections.map((section) => ({
      classNbr: section.class_nbr,
      term: section.term,
      enqueuedAt: new Date().toISOString(),
      staggerGroup,
    }));

    // Enqueue all sections to BullMQ for parallel processing
    try {
      await enqueueClassCheckBulk(jobs);
    } catch (queueError) {
      const errorMsg = queueError instanceof Error ? queueError.message : 'Unknown error';
      console.error(`[Cron] Queue error enqueueing ${jobs.length} sections: ${errorMsg}`);
      throw queueError;
    }

    const durationMs = Date.now() - startTime;
    console.log(
      `[Cron] Successfully enqueued ${sections.length} sections in ${durationMs}ms (stagger: ${staggerGroup})`
    );

    return {
      success: true,
      sectionsEnqueued: sections.length,
      staggerGroup,
      durationMs,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const durationMs = Date.now() - startTime;
    console.error(`[Cron] Fatal error after ${durationMs}ms: ${errorMessage}`);

    return {
      success: false,
      sectionsEnqueued: 0,
      staggerGroup: determineStaggerGroup(),
      durationMs,
      error: errorMessage,
    };
  } finally {
    // Release lock if it was acquired
    if (lockAcquired && lockId !== undefined) {
      try {
        const releaseResult = await releaseLock(lockId as string);
        if (releaseResult.released) {
          console.log(`[Cron] Lock released (holder: ${lockId})`);
        } else {
          console.warn(`[Cron] Lock release failed for ${lockId}: ${releaseResult.message}`);
        }
      } catch (releaseError) {
        const errorMsg = releaseError instanceof Error ? releaseError.message : 'Unknown error';
        console.error(`[Cron] Error releasing lock ${lockId}: ${errorMsg}`);
        // Don't throw - lock will auto-expire after 25 minutes
      }
    }
  }
}

/**
 * Determine the stagger group based on current time
 *
 * Uses modulo calculation to properly handle both :00 and :30 minute triggers:
 * - Math.floor(currentMinute / 30) gives: 0 for :00-:29, 1 for :30-:59
 * - Modulo 2 alternates between 0 and 1 for each 30-minute window
 * - Result: :00 -> even (0 % 2 = 0), :30 -> odd (1 % 2 = 1)
 *
 * @returns 'even' or 'odd' based on current minute
 */
function determineStaggerGroup(): 'even' | 'odd' {
  const now = new Date();
  const currentMinute = now.getMinutes();
  return Math.floor(currentMinute / 30) % 2 === 0 ? 'even' : 'odd';
}
