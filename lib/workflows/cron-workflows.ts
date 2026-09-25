import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
  type WorkflowStepConfig,
} from 'cloudflare:workers';
import { sql } from 'drizzle-orm';
import { getPastTermCodes } from '@/lib/asu/terms';
import { type Database, getDb } from '@/lib/db';
import { deletePastTermWatches, getSectionsToCheck } from '@/lib/db/queries';
import { log } from '@/lib/log';
import type { SectionRef } from '@/lib/section-ref';
import type { Env } from '@/lib/types/env';
import type { ClassCheckMessage } from '@/lib/types/queue';
import type { StaggerGroup } from '@/lib/types/stagger';

const CF_QUEUE_SEND_BATCH_LIMIT = 100;

const STEP_CONFIG = {
  retries: { limit: 5, delay: '10 seconds', backoff: 'exponential' },
  timeout: '2 minutes',
} satisfies WorkflowStepConfig;

interface CronWorkflowEnv {
  HYPERDRIVE: Env['HYPERDRIVE'];
  PICKMYCLASS_QUEUE: Pick<Env['PICKMYCLASS_QUEUE'], 'sendBatch'>;
}

async function expireStaleNotifications(db: Database): Promise<number> {
  const rows = await db.execute<{ expired: unknown }>(
    sql`SELECT public.expire_stale_notifications() AS expired`
  );

  return Number(rows[0]?.expired ?? 0);
}

/** The scheduled fire time, or the manual-trigger time when started with `wrangler workflows trigger`. */
function firedAt(event: Readonly<WorkflowEvent<unknown>>): Date {
  return new Date(event.schedule?.scheduledTime ?? event.timestamp.getTime());
}

export function staggerGroupFor(time: Date): StaggerGroup {
  return Math.floor(time.getMinutes() / 30) % 2 === 0 ? 'even' : 'odd';
}

function rejectedReasons(results: PromiseSettledResult<unknown>[]): string[] {
  return results.flatMap((result) =>
    result.status === 'rejected'
      ? [result.reason instanceof Error ? result.reason.message : String(result.reason)]
      : []
  );
}

/**
 * Every 30 minutes (`schedules` in wrangler.jsonc): expire stale notification
 * claims, load the stagger group's sections, and enqueue one Section Check per
 * section. Each step retries on its own; a batch that still fails after its
 * retries errors the instance after the other batches are enqueued.
 *
 * Overlapping or duplicate instances are safe without a lock: every message
 * carries the `cycle` stamp that `processSection` uses to skip a section already
 * checked this cycle, and the conditional `class_states` upsert rejects stale writes.
 */
export class SectionCheckWorkflow extends WorkflowEntrypoint<CronWorkflowEnv> {
  async run(event: Readonly<WorkflowEvent<unknown>>, step: WorkflowStep) {
    const now = firedAt(event);
    const staggerGroup = staggerGroupFor(now);
    const cycle = `${now.toISOString()}:${staggerGroup}`;

    try {
      const expired = await step.do('expire stale notifications', STEP_CONFIG, () =>
        expireStaleNotifications(getDb(this.env.HYPERDRIVE))
      );

      if (expired > 0) log('SectionCheck').info(`Expired ${expired} stale notification records`);
    } catch (error) {
      // Best-effort here: the 04:05 maintenance run expires them too, and a
      // failed sweep must not block this cycle's checks.
      log('SectionCheck').warn('Failed to expire stale notifications:', error);
    }

    const sections = await step.do('load sections', STEP_CONFIG, async () => {
      const all = await getSectionsToCheck(getDb(this.env.HYPERDRIVE), staggerGroup);
      const pastTerms = new Set(getPastTermCodes());

      return all.flatMap(({ class_nbr, term }): SectionRef[] =>
        pastTerms.has(term) ? [] : [{ class_nbr, term }]
      );
    });

    log('SectionCheck').info(`Enqueueing ${sections.length} sections (cycle ${cycle})`);

    const batches: SectionRef[][] = [];

    for (let i = 0; i < sections.length; i += CF_QUEUE_SEND_BATCH_LIMIT) {
      batches.push(sections.slice(i, i + CF_QUEUE_SEND_BATCH_LIMIT));
    }

    const results = await Promise.allSettled(
      batches.map((batch, index) =>
        step.do(`enqueue batch ${index + 1}/${batches.length}`, STEP_CONFIG, async () => {
          const enqueuedAt = new Date().toISOString();

          await this.env.PICKMYCLASS_QUEUE.sendBatch(
            batch.map((section) => ({
              body: { ...section, enqueued_at: enqueuedAt, cycle } satisfies ClassCheckMessage,
            }))
          );

          return batch.length;
        })
      )
    );

    const failures = rejectedReasons(results);

    if (failures.length > 0) {
      throw new Error(
        `${failures.length}/${batches.length} enqueue batches failed: ${failures.join('; ')}`
      );
    }

    return { cycle, sections_enqueued: sections.length, batches: batches.length };
  }
}

/**
 * Daily at 04:05 UTC: expire stale notification claims and delete watches for
 * past terms. The two steps are independent; either failing errors the instance
 * after the other has run.
 */
export class MaintenanceWorkflow extends WorkflowEntrypoint<CronWorkflowEnv> {
  async run(_event: Readonly<WorkflowEvent<unknown>>, step: WorkflowStep) {
    const [expired, swept] = await Promise.allSettled([
      step.do('expire stale notifications', STEP_CONFIG, () =>
        expireStaleNotifications(getDb(this.env.HYPERDRIVE))
      ),
      step.do('sweep past-term watches', STEP_CONFIG, () =>
        deletePastTermWatches(getDb(this.env.HYPERDRIVE), getPastTermCodes())
      ),
    ]);

    if (expired.status === 'rejected' || swept.status === 'rejected') {
      throw new Error(`Maintenance failed: ${rejectedReasons([expired, swept]).join('; ')}`);
    }

    log('Maintenance').info(
      `Expired ${expired.value} stale notifications, swept ${swept.value} past-term watches`
    );

    return { expired: expired.value, swept: swept.value };
  }
}
