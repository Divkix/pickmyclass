/**
 * Node-cron Scheduler
 *
 * Sets up scheduled cron jobs using node-cron.
 * Provides start/stop functions for graceful lifecycle management.
 *
 * Schedule: 0,30 * * * * (every 30 minutes at :00 and :30)
 */

import type { ScheduledTask } from 'node-cron';
import cron from 'node-cron';
import { runClassCheckCron } from './class-check';

/**
 * Cron expression for class checks
 * Runs at minute 0 and 30 of every hour
 */
const CLASS_CHECK_SCHEDULE = '0,30 * * * *';

/**
 * Timezone for scheduling (ASU - no DST)
 */
const TIMEZONE = 'America/Phoenix';

/**
 * Active scheduled task reference
 * Used to stop the scheduler gracefully
 */
let classCheckTask: ScheduledTask | null = null;

/**
 * Whether the scheduler is currently running
 */
let isRunning = false;

/**
 * Start the cron scheduler
 *
 * Sets up the class check cron job to run every 30 minutes.
 * If already running, this is a no-op.
 *
 * @example
 * startScheduler();
 * // Scheduler is now running at :00 and :30
 *
 * @example
 * // In application startup:
 * import { startScheduler } from '@/lib/cron/scheduler';
 * startScheduler();
 */
export function startScheduler(): void {
  if (isRunning) {
    console.log('[Scheduler] Already running, skipping start');
    return;
  }

  try {
    console.log('[Scheduler] Starting cron scheduler...');

    // Schedule class check job
    // Note: node-cron 4.x uses TaskContext as callback argument
    classCheckTask = cron.schedule(
      CLASS_CHECK_SCHEDULE,
      async () => {
        const triggerTime = new Date().toISOString();
        console.log(`[Scheduler] Class check cron triggered at ${triggerTime}`);

        try {
          const result = await runClassCheckCron();

          if (result.success) {
            console.log(
              `[Scheduler] Cron completed at ${triggerTime}: ${result.sectionsEnqueued} sections enqueued in ${result.durationMs}ms`
            );
          } else {
            console.error(`[Scheduler] Cron failed at ${triggerTime}: ${result.error}`);
          }
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : 'Unknown error';
          console.error(
            `[Scheduler] Unexpected error in cron handler at ${triggerTime}: ${errorMsg}`
          );
        }
      },
      {
        name: 'class-check',
        timezone: TIMEZONE,
      }
    );

    // Start the task (node-cron 4.x tasks don't auto-start)
    classCheckTask.start();

    isRunning = true;
    console.log(`[Scheduler] Started with schedule: ${CLASS_CHECK_SCHEDULE}`);
    console.log(`[Scheduler] Timezone: ${TIMEZONE} (ASU)`);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[Scheduler] Error starting scheduler: ${errorMsg}`);
    throw error;
  }
}

/**
 * Stop the cron scheduler
 *
 * Stops all scheduled tasks gracefully.
 * Safe to call even if not running.
 *
 * @example
 * // In graceful shutdown:
 * stopScheduler();
 *
 * @example
 * // In SIGTERM handler:
 * process.on('SIGTERM', () => {
 *   stopScheduler();
 *   process.exit(0);
 * });
 */
export function stopScheduler(): void {
  if (!isRunning) {
    console.log('[Scheduler] Not running, skipping stop');
    return;
  }

  try {
    console.log('[Scheduler] Stopping cron scheduler...');

    if (classCheckTask) {
      classCheckTask.stop();
      console.log('[Scheduler] Class check task stopped');
    }

    console.log('[Scheduler] Stopped');
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[Scheduler] Error stopping scheduler: ${errorMsg}`);
    // Don't re-throw - shutdown should continue
  } finally {
    classCheckTask = null;
    isRunning = false;
  }
}

/**
 * Get scheduler status information
 *
 * Useful for health checks and monitoring.
 *
 * @returns Object with scheduler status
 */
export function getSchedulerStatus(): {
  running: boolean;
  schedule: string;
  timezone: string;
} {
  return {
    running: isRunning,
    schedule: CLASS_CHECK_SCHEDULE,
    timezone: TIMEZONE,
  };
}
