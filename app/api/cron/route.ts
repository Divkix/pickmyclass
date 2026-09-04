import { env } from 'cloudflare:workers';
import { type NextRequest } from 'next/server';
import { requireCronAuth } from '@/lib/auth/require-user';
import { fail, ok } from '@/lib/api/response';
import { getDbFromEnv } from '@/lib/db';
import { getSectionsToCheck } from '@/lib/db/queries';
import { getPastTermCodes } from '@/lib/asu/terms';
import { log } from '@/lib/log';
import type { Env } from '@/lib/types/env';
import type { ClassCheckMessage } from '@/lib/types/queue';
import type { StaggerGroup } from '@/lib/types/stagger';
import { createCronLockClient, type CronLockLease } from '@/lib/worker/cron-lock';

const CF_QUEUE_SEND_BATCH_LIMIT = 100;
const HTTP_MULTI_STATUS = 207;
export async function GET(request: NextRequest) {
  const startTime = Date.now();
  const lockHolder = `cron-${Date.now()}-${crypto.randomUUID()}`;
  let lockLease: CronLockLease | null = null;

  try {
    const rawEnv: unknown = env;
    // SAFETY: Env reflects wrangler.jsonc bindings validated at deploy; narrowed from unknown
    const cfEnv = rawEnv as Env;
    const cronAuth = requireCronAuth(request, cfEnv.CRON_SECRET);
    if (cronAuth) {
      if (cronAuth.status === 500) log('Cron').error('CRON_SECRET not configured');
      else log('Cron').warn('Unauthorized request - invalid or missing authentication');
      return cronAuth;
    }

    const lockClient = createCronLockClient(cfEnv.PICKMYCLASS_CRON_LOCK_DO);
    lockLease = await lockClient.acquire(lockHolder);
    if (!lockLease.configured) {
      log('Cron').warn('PICKMYCLASS_CRON_LOCK_DO not available - proceeding without lock');
    } else {
      if (!lockLease.acquired) {
        log('Cron').warn('Lock acquisition failed:', lockLease.message);
        return fail('Another cron job is already running', 409, {
          message: lockLease.message,
          current_holder: lockLease.currentHolder,
        });
      }
      log('Cron').info('Lock acquired successfully');
    }

    const scheduledTimeHeader = request.headers.get('X-Cron-Scheduled-Time');
    const now = scheduledTimeHeader ? new Date(Number(scheduledTimeHeader)) : new Date();
    const currentMinute = now.getMinutes();
    const staggerGroup: StaggerGroup = Math.floor(currentMinute / 30) % 2 === 0 ? 'even' : 'odd';
    log('Cron').info(
      `Starting 30-minute class check (stagger: ${staggerGroup}, time: ${now.toISOString()})`
    );

    const queue = cfEnv.PICKMYCLASS_QUEUE;

    if (!queue) {
      log('Cron').error('PICKMYCLASS_QUEUE binding not found');
      return fail('Queue binding not configured', 500);
    }

    const db = getDbFromEnv();

    const allSections = await getSectionsToCheck(db, staggerGroup);
    const pastTerms = new Set(getPastTermCodes());
    const sections = allSections.filter((s) => !pastTerms.has(s.term));
    const skippedPastTerm = allSections.length - sections.length;
    if (skippedPastTerm > 0) {
      log('Cron').info(`Skipped ${skippedPastTerm} past-term sections`);
    }

    log('Cron').info(`Enqueueing ${sections.length} sections to queue`);

    if (sections.length === 0) {
      log('Cron').info('No sections to check');
      return ok({
        message: 'No sections to check',
        sections_enqueued: 0,
        stagger_group: staggerGroup,
        duration: Date.now() - startTime,
      });
    }

    const batches: ClassCheckMessage[][] = [];

    for (let i = 0; i < sections.length; i += CF_QUEUE_SEND_BATCH_LIMIT) {
      batches.push(
        sections.slice(i, i + CF_QUEUE_SEND_BATCH_LIMIT).map(
          (section) =>
            ({
              class_nbr: section.class_nbr,
              term: section.term,
              enqueued_at: new Date().toISOString(),
            }) satisfies ClassCheckMessage
        )
      );
    }

    const firstPassResults = await Promise.allSettled(
      batches.map((batch) => queue.sendBatch(batch.map((msg) => ({ body: msg }))))
    );

    const initialFailures = firstPassResults
      .map((result, idx) => ({ result, idx }))
      .filter(({ result }) => result.status === 'rejected');

    let batchResults = firstPassResults;

    if (initialFailures.length > 0) {
      log('Cron').warn(
        `${initialFailures.length}/${batches.length} batches failed on first attempt — retrying`
      );
      const retryResults = await Promise.allSettled(
        initialFailures.map(({ idx }) =>
          queue.sendBatch(batches[idx].map((msg) => ({ body: msg })))
        )
      );

      batchResults = [...firstPassResults];
      for (let i = 0; i < initialFailures.length; i++) {
        batchResults[initialFailures[i].idx] = retryResults[i];
      }
    }

    const failedBatches = batchResults.filter((r) => r.status === 'rejected');
    if (failedBatches.length > 0) {
      log('Cron').error(`${failedBatches.length}/${batches.length} batches failed to enqueue`);
      for (const failed of failedBatches) {
        if (failed.status === 'rejected') {
          log('Cron').error('Batch error:', failed.reason);
        }
      }
    }

    const successfulBatches = batchResults.filter((r) => r.status === 'fulfilled').length;
    const successfullyEnqueuedCount = batchResults.reduce(
      (count, result, idx) => count + (result.status === 'fulfilled' ? batches[idx].length : 0),
      0
    );

    const duration = Date.now() - startTime;
    log('Cron').info(
      `Enqueued ${successfullyEnqueuedCount} sections in ${duration}ms (${successfulBatches}/${batches.length} batches succeeded)`
    );

    const hasFailedBatches = failedBatches.length > 0;

    if (hasFailedBatches) {
      return fail('Some batches failed to enqueue', HTTP_MULTI_STATUS, {
        sections_enqueued: successfullyEnqueuedCount,
        batches_total: batches.length,
        batches_failed: failedBatches.length,
        stagger_group: staggerGroup,
        duration,
      });
    }

    return ok({
      sections_enqueued: successfullyEnqueuedCount,
      batches_total: batches.length,
      batches_failed: 0,
      stagger_group: staggerGroup,
      duration,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    log('Cron').error('Fatal error:', errorMessage);

    return fail(errorMessage, 500, { duration: Date.now() - startTime });
  } finally {
    if (lockLease?.acquired) {
      try {
        await lockLease.release();
        if (lockLease.configured) log('Cron').info('Lock released');
      } catch (error) {
        log('Cron').error('Error releasing lock:', error);
      }
    }
  }
}
