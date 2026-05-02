/**
 * Cloudflare Workers Cron Job
 *
 * This route is triggered every 30 minutes by Cloudflare Workers cron.
 * It enqueues class sections to the Cloudflare Queue for parallel processing.
 *
 * Cron schedule: "0,30 * * * *" (every 30 minutes)
 * - :00 minutes → Even class numbers (0, 2, 4, 6, 8)
 * - :30 minutes → Odd class numbers (1, 3, 5, 7, 9)
 *
 * Configured in: wrangler.jsonc
 */

import { env } from 'cloudflare:workers';
import { type NextRequest, NextResponse } from 'next/server';
import { getSectionsToCheck } from '@/lib/db/queries';
import type { Env } from '@/lib/types/env';
import type { ClassCheckMessage } from '@/lib/types/queue';
import { timingSafeCompare } from '@/lib/utils/crypto';

/**
 * Main cron handler with staggered checking
 */
export async function GET(request: NextRequest) {
  const startTime = Date.now();
  const lockHolder = `cron-${Date.now()}-${crypto.randomUUID()}`;
  let lockAcquired = false;

  try {
    const cfEnv = env as unknown as Env;

    const authHeader = request.headers.get('authorization');
    const expectedSecret = cfEnv.CRON_SECRET;

    if (!expectedSecret) {
      console.error('[Cron] CRON_SECRET not configured');
      return NextResponse.json(
        {
          success: false,
          error: 'Server configuration error',
        },
        { status: 500 }
      );
    }

    const isAuthorized =
      authHeader !== null && timingSafeCompare(authHeader, `Bearer ${expectedSecret}`);

    if (!isAuthorized) {
      console.warn('[Cron] Unauthorized request - invalid or missing authentication');

      return NextResponse.json(
        {
          success: false,
          error: 'Unauthorized - this endpoint requires authentication',
        },
        { status: 401 }
      );
    }

    if (cfEnv.PICKMYCLASS_CRON_LOCK_DO) {
      const lockId = cfEnv.PICKMYCLASS_CRON_LOCK_DO.idFromName('pickmyclass-cron-lock');
      const lockStub = cfEnv.PICKMYCLASS_CRON_LOCK_DO.get(lockId);

      const lockResponse = await lockStub.fetch(`http://do/acquire?holder=${lockHolder}`, {
        method: 'POST',
      });
      const lockResult = (await lockResponse.json()) as {
        acquired: boolean;
        message: string;
        lockHolder?: string;
      };

      if (!lockResult.acquired) {
        console.warn('[Cron] Lock acquisition failed:', lockResult.message);
        return NextResponse.json(
          {
            success: false,
            error: 'Another cron job is already running',
            details: lockResult.message,
            current_holder: lockResult.lockHolder,
          },
          { status: 409 }
        );
      }

      lockAcquired = true;
      console.log('[Cron] Lock acquired successfully');
    } else {
      console.warn('[Cron] PICKMYCLASS_CRON_LOCK_DO not available - proceeding without lock');
    }

    // Use modulo calculation to properly handle both :00 and :30 minute triggers
    // Math.floor(currentMinute / 30) gives us: 0 for :00-:29, 1 for :30-:59
    // Modulo 2 alternates between 0 and 1 for each 30-minute window
    // Result: :00 → even (0 % 2 = 0), :30 → odd (1 % 2 = 1)
    const now = new Date();
    const currentMinute = now.getMinutes();
    const staggerGroup = Math.floor(currentMinute / 30) % 2 === 0 ? 'even' : 'odd';

    console.log(
      `[Cron] Starting 30-minute class check (stagger: ${staggerGroup}, time: ${now.toISOString()})`
    );

    const queue = cfEnv.PICKMYCLASS_QUEUE;

    if (!queue) {
      console.error('[Cron] PICKMYCLASS_QUEUE binding not found');
      return NextResponse.json(
        {
          success: false,
          error: 'Queue binding not configured',
        },
        { status: 500 }
      );
    }

    // Use server-side filtering function to get sections for this stagger group
    const sections = await getSectionsToCheck(staggerGroup);

    console.log(`[Cron] Enqueueing ${sections.length} sections to queue`);

    if (sections.length === 0) {
      console.log('[Cron] No sections to check');
      return NextResponse.json({
        success: true,
        message: 'No sections to check',
        sections_enqueued: 0,
        stagger_group: staggerGroup,
        duration: Date.now() - startTime,
      });
    }

    // Enqueue using sendBatch API (100 messages per batch, CF limit)
    const BATCH_SIZE = 100;
    const batches: ClassCheckMessage[][] = [];

    for (let i = 0; i < sections.length; i += BATCH_SIZE) {
      batches.push(
        sections.slice(i, i + BATCH_SIZE).map(
          (section) =>
            ({
              class_nbr: section.class_nbr,
              term: section.term,
              enqueued_at: new Date().toISOString(),
              stagger_group: staggerGroup,
            }) satisfies ClassCheckMessage
        )
      );
    }

    const batchResults = await Promise.allSettled(
      batches.map((batch) => queue.sendBatch(batch.map((msg) => ({ body: msg }))))
    );

    const failedBatches = batchResults.filter((r) => r.status === 'rejected');
    if (failedBatches.length > 0) {
      console.error(`[Cron] ${failedBatches.length}/${batches.length} batches failed to enqueue`);
      for (const failed of failedBatches) {
        if (failed.status === 'rejected') {
          console.error('[Cron] Batch error:', failed.reason);
        }
      }
    }

    const successfulBatches = batchResults.filter((r) => r.status === 'fulfilled').length;

    const duration = Date.now() - startTime;
    console.log(
      `[Cron] Enqueued ${sections.length} sections in ${duration}ms (${successfulBatches}/${batches.length} batches succeeded)`
    );

    // Return success:false if any batches failed
    const hasFailedBatches = failedBatches.length > 0;

    return NextResponse.json(
      {
        success: !hasFailedBatches,
        sections_enqueued: sections.length,
        batches_total: batches.length,
        batches_failed: failedBatches.length,
        stagger_group: staggerGroup,
        duration,
      },
      { status: hasFailedBatches ? 207 : 200 } // 207 Multi-Status for partial failures
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Cron] Fatal error:', errorMessage);

    return NextResponse.json(
      {
        success: false,
        error: errorMessage,
        duration: Date.now() - startTime,
      },
      { status: 500 }
    );
  } finally {
    // Release lock if it was acquired
    if (lockAcquired) {
      try {
        const cfEnv = env as unknown as Env;

        if (cfEnv.PICKMYCLASS_CRON_LOCK_DO) {
          const lockId = cfEnv.PICKMYCLASS_CRON_LOCK_DO.idFromName('pickmyclass-cron-lock');
          const lockStub = cfEnv.PICKMYCLASS_CRON_LOCK_DO.get(lockId);

          await lockStub.fetch(`http://do/release?holder=${lockHolder}`, {
            method: 'POST',
          });
          console.log('[Cron] Lock released');
        }
      } catch (error) {
        console.error('[Cron] Error releasing lock:', error);
        // Don't throw - lock will auto-expire after 25 minutes
      }
    }
  }
}
