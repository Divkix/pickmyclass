import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
  type WorkflowStepConfig,
} from "cloudflare:workers";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { purgeExpiredAccounts } from "@/lib/auth/clerk-purge";
import { getPastTermCodes } from "@/lib/asu/terms";
import { type Database, getDb } from "@/lib/db";
import { deletePastTermWatches, getSectionsToCheck } from "@/lib/db/queries";
import { errorFields, log, logEvent, tagLogs } from "@/lib/log";
import type { SectionRef } from "@/lib/section-ref";
import { sendQueueBatch } from "@/lib/queue/transport";
import { withSpan } from "@/lib/telemetry/span";
import type { Env } from "@/lib/types/env";
import type { ClassCheckMessage } from "@/lib/types/queue";
import type { StaggerGroup } from "@/lib/types/stagger";
import { failPermanently } from "@/lib/workflows/step-errors";

const CF_QUEUE_SEND_BATCH_LIMIT = 100;

const STEP_CONFIG = {
  retries: { limit: 5, delay: "10 seconds", backoff: "exponential" },
  timeout: "2 minutes",
} satisfies WorkflowStepConfig;

interface CronWorkflowEnv {
  CF_VERSION_METADATA?: Env["CF_VERSION_METADATA"];
  HYPERDRIVE: Env["HYPERDRIVE"];
  PICKMYCLASS_QUEUE: Pick<Env["PICKMYCLASS_QUEUE"], "sendBatch">;
}

const expiredRowSchema = z.object({ expired: z.coerce.number().int().nonnegative() });

async function expireStaleNotifications(db: Database): Promise<number> {
  const { rows } = await db.execute(sql`SELECT public.expire_stale_notifications() AS expired`);

  return expiredRowSchema.parse(rows[0]).expired;
}

/** The scheduled fire time, or the manual-trigger time when started with `wrangler workflows trigger`. */
function firedAt(event: Readonly<WorkflowEvent<unknown>>): Date {
  return new Date(event.schedule?.scheduledTime ?? event.timestamp.getTime());
}

export function staggerGroupFor(time: Date): StaggerGroup {
  return Math.floor(time.getMinutes() / 15) % 2 === 0 ? "even" : "odd";
}

/** The Cron Cycle stamp, `<ISO fire time>:<group>`; `cycleElapsedMs` parses it back. */
export function cycleStamp(firedAt: Date, group: StaggerGroup): string {
  return `${firedAt.toISOString()}:${group}`;
}

/** Milliseconds since the Cron Cycle's scheduled fire time, from its `cycleStamp`. */
export function cycleElapsedMs(cycle: string | undefined, now: number): number | undefined {
  if (!cycle) return undefined;
  const firedAt = Date.parse(cycle.slice(0, cycle.lastIndexOf(":")));

  return Number.isNaN(firedAt) ? undefined : now - firedAt;
}

/**
 * Logs each rejected step with its stack and returns the messages, so the
 * instance's own error (which marks the run failed) names every cause.
 */
function rejectedReasons(
  scope: string,
  steps: readonly string[],
  results: PromiseSettledResult<unknown>[],
): string[] {
  return results.flatMap((result, index) => {
    if (result.status === "fulfilled") return [];
    const fields = errorFields(result.reason);
    log(scope).error("Workflow step failed after retries", { step: steps[index], ...fields });

    return [fields["error.message"]];
  });
}

/**
 * Every 15 minutes (`schedules` in wrangler.jsonc), so each stagger group is checked every 30 minutes: expire stale notification
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
    tagLogs(this.env.CF_VERSION_METADATA?.id);
    const now = firedAt(event);
    const staggerGroup = staggerGroupFor(now);
    const cycle = cycleStamp(now, staggerGroup);

    try {
      // Logs inside step callbacks run once; run() itself replays after each hibernation.
      await step.do("expire stale notifications", STEP_CONFIG, () =>
        failPermanently(async () => {
          const expired = await expireStaleNotifications(getDb(this.env.HYPERDRIVE));

          if (expired > 0)
            log("SectionCheck").info("Expired stale notifications", { cycle, expired });

          return expired;
        }),
      );
    } catch (error) {
      // Best-effort here: the 04:05 maintenance run expires them too, and a
      // failed sweep must not block this cycle's checks.
      log("SectionCheck").warn("Failed to expire stale notifications", {
        cycle,
        ...errorFields(error),
      });
    }

    const sections = await step.do("load sections", STEP_CONFIG, () =>
      failPermanently(async () => {
        const all = await getSectionsToCheck(getDb(this.env.HYPERDRIVE), staggerGroup);
        const pastTerms = new Set(getPastTermCodes());

        const current = all.flatMap(({ class_nbr, term }): SectionRef[] =>
          pastTerms.has(term) ? [] : [{ class_nbr, term }],
        );

        log("SectionCheck").info("Enqueueing sections", {
          cycle,
          workflow_instance_id: event.instanceId,
          stagger_group: staggerGroup,
          sections: current.length,
        });

        return current;
      }),
    );

    const batches: SectionRef[][] = [];

    for (let i = 0; i < sections.length; i += CF_QUEUE_SEND_BATCH_LIMIT) {
      batches.push(sections.slice(i, i + CF_QUEUE_SEND_BATCH_LIMIT));
    }

    const stepNames = batches.map((_, index) => `enqueue batch ${index + 1}/${batches.length}`);

    const results = await Promise.allSettled(
      batches.map((batch, index) =>
        step.do(stepNames[index], STEP_CONFIG, () =>
          failPermanently(async () => {
            const enqueuedAt = new Date().toISOString();

            const messages = batch.map((section) => ({
              body: {
                ...section,
                enqueued_at: enqueuedAt,
                cycle,
                workflow_instance_id: event.instanceId,
              } satisfies ClassCheckMessage,
            }));

            // Queue sends get no runtime span of their own.
            await withSpan(
              "queue.send_batch",
              {
                cycle,
                workflow_instance_id: event.instanceId,
                "messaging.batch.message_count": batch.length,
              },
              () => sendQueueBatch(this.env.PICKMYCLASS_QUEUE, messages),
            );

            return batch.length;
          }),
        ),
      ),
    );

    const failures = rejectedReasons("SectionCheck", stepNames, results);

    // In a step so the event fires once, not on every replay of run().
    await step.do("record cycle", STEP_CONFIG, async () => {
      logEvent("section_check_cycle_enqueued", {
        cycle,
        workflow_instance_id: event.instanceId,
        stagger_group: staggerGroup,
        sections: sections.length,
        batches: batches.length,
        failed_batches: failures.length,
        enqueue_lag_ms: Date.now() - now.getTime(),
      });

      return failures.length;
    });

    if (failures.length > 0) {
      throw new Error(
        `${failures.length}/${batches.length} enqueue batches failed: ${failures.join("; ")}`,
      );
    }

    return { cycle, sections_enqueued: sections.length, batches: batches.length };
  }
}

const MAINTENANCE_STEPS = [
  "expire stale notifications",
  "sweep past-term watches",
  "purge expired data",
] as const;

/**
 * Daily at 04:05 UTC: expire stale notification claims, delete watches for past
 * terms, and purge data past the privacy policy's retention windows. The steps
 * are independent; any failing errors the instance after the others have run.
 */

export class MaintenanceWorkflow extends WorkflowEntrypoint<CronWorkflowEnv> {
  async run(_event: Readonly<WorkflowEvent<unknown>>, step: WorkflowStep) {
    tagLogs(this.env.CF_VERSION_METADATA?.id);

    const [expired, swept, purged] = await Promise.allSettled([
      step.do(MAINTENANCE_STEPS[0], STEP_CONFIG, () =>
        failPermanently(() => expireStaleNotifications(getDb(this.env.HYPERDRIVE))),
      ),
      step.do(MAINTENANCE_STEPS[1], STEP_CONFIG, () =>
        failPermanently(() =>
          deletePastTermWatches(getDb(this.env.HYPERDRIVE), getPastTermCodes()),
        ),
      ),
      step.do(MAINTENANCE_STEPS[2], STEP_CONFIG, () =>
        failPermanently(() => purgeExpiredAccounts(getDb(this.env.HYPERDRIVE))),
      ),
    ]);

    if (
      expired.status === "rejected" ||
      swept.status === "rejected" ||
      purged.status === "rejected"
    ) {
      const reasons = rejectedReasons("Maintenance", MAINTENANCE_STEPS, [expired, swept, purged]);
      throw new Error(`Maintenance failed: ${reasons.join("; ")}`);
    }

    log("Maintenance").info("Maintenance complete", {
      expired: expired.value,
      swept: swept.value,
      ...purged.value,
    });

    return { expired: expired.value, swept: swept.value, ...purged.value };
  }
}
