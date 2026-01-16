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
import { acquireLock, releaseLock } from '@/lib/redis/cron-lock';

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
  let lockAcquired = false;
  let lockId: string | undefined;

  try {
    // Acquire distributed lock to prevent concurrent cron runs
    const lockResult = await acquireLock();

    if (!lockResult.acquired) {
      console.warn('[Cron] Lock acquisition failed:', lockResult.message);
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
    console.log('[Cron] Lock acquired successfully');

    // Determine stagger group based on current time
    // :00 -> even, :30 -> odd
    const staggerGroup = determineStaggerGroup();

    console.log(
      `[Cron] Starting 30-minute class check (stagger: ${staggerGroup}, time: ${new Date().toISOString()})`
    );

    // Fetch sections to check from database
    const sections = await getSectionsToCheck(staggerGroup);

    console.log(`[Cron] Found ${sections.length} sections to check`);

    // Handle case with no sections
    if (sections.length === 0) {
      console.log('[Cron] No sections to check');
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
    await enqueueClassCheckBulk(jobs);

    const durationMs = Date.now() - startTime;
    console.log(`[Cron] Enqueued ${sections.length} sections in ${durationMs}ms`);

    return {
      success: true,
      sectionsEnqueued: sections.length,
      staggerGroup,
      durationMs,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Cron] Fatal error:', errorMessage);

    return {
      success: false,
      sectionsEnqueued: 0,
      staggerGroup: determineStaggerGroup(),
      durationMs: Date.now() - startTime,
      error: errorMessage,
    };
  } finally {
    // Release lock if it was acquired
    if (lockAcquired) {
      try {
        const releaseResult = await releaseLock(lockId);
        if (releaseResult.released) {
          console.log('[Cron] Lock released');
        } else {
          console.warn('[Cron] Lock release failed:', releaseResult.message);
        }
      } catch (error) {
        console.error('[Cron] Error releasing lock:', error);
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
