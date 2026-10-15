import { Effect } from "effect";
import { randomUUID } from "node:crypto";
import { and, eq, isNull, lt, or, sql } from "drizzle-orm";
import { z } from "zod";
import { NOTIFICATION_LEASE_SECONDS } from "@/lib/config";
import type { Database } from "@/lib/db";
import { driverErrorMessage } from "@/lib/db/pg-errors";
import { pendingSectionNotifications } from "@/lib/db/schema";
import { sendSectionNotificationsEffect } from "@/lib/queue/notification-sender";
import type { SectionRef } from "@/lib/section-ref";
import type { ClassDetails } from "@/lib/types/class";
import type { Env } from "@/lib/types/env";

export class NotificationLeaseBusy extends Error {
  constructor(public retryAfterSeconds: number) {
    super("Notification delivery is already in progress");
  }
}

export async function recordSectionCheck(
  db: Database,
  ref: SectionRef,
  details: ClassDetails,
  observedAt: Date,
): Promise<boolean> {
  try {
    const { rows } = await db.execute(sql`SELECT public.record_section_check(
    ${ref.class_nbr}::text, ${ref.term}::text, ${JSON.stringify(details)}::jsonb,
    ${observedAt.toISOString()}::timestamptz) AS applied`);

    return z.object({ applied: z.boolean() }).parse(rows[0]).applied;
  } catch (error) {
    throw new Error(`Failed to record section check: ${driverErrorMessage(error)}`);
  }
}

function forSection(ref: SectionRef) {
  return and(
    eq(pendingSectionNotifications.class_nbr, ref.class_nbr),
    eq(pendingSectionNotifications.term, ref.term),
  );
}

interface OwnedNotification {
  intent: typeof pendingSectionNotifications.$inferSelect;
  leaseId: string;
}

async function acquirePendingNotification(
  db: Database,
  ref: SectionRef,
): Promise<OwnedNotification | undefined> {
  // Expired alerts must not freeze future checks or deliver stale availability.
  // In-flight owners keep their lease; only undelivered claims are discarded.
  await db.execute(sql`WITH expired AS (
    DELETE FROM public.pending_section_notifications
    WHERE class_nbr = ${ref.class_nbr} AND term = ${ref.term} AND expires_at <= now()
      AND (leased_until IS NULL OR leased_until < now()) RETURNING id
  ) DELETE FROM public.notifications_sent WHERE delivery_intent_id IN (SELECT id FROM expired) AND delivered_at IS NULL`);

  const [pending] = await db
    .select()
    .from(pendingSectionNotifications)
    .where(forSection(ref))
    .limit(1);

  if (!pending) return undefined;

  const leaseId = randomUUID();

  const [owned] = await db
    .update(pendingSectionNotifications)
    .set({
      lease_id: leaseId,
      leased_until: sql`now() + ${NOTIFICATION_LEASE_SECONDS} * interval '1 second'`,
    })
    .where(
      and(
        forSection(ref),
        eq(pendingSectionNotifications.id, pending.id),
        or(
          isNull(pendingSectionNotifications.leased_until),
          lt(pendingSectionNotifications.leased_until, sql`now()`),
        ),
      ),
    )
    .returning();

  if (!owned) {
    const remaining = pending.leased_until
      ? Math.ceil((Date.parse(pending.leased_until) - Date.now()) / 1000)
      : NOTIFICATION_LEASE_SECONDS;

    throw new NotificationLeaseBusy(Math.max(1, remaining));
  }

  return { intent: owned, leaseId };
}

function ownsNotification(ref: SectionRef, owned: OwnedNotification) {
  return and(
    forSection(ref),
    eq(pendingSectionNotifications.id, owned.intent.id),
    eq(pendingSectionNotifications.lease_id, owned.leaseId),
  );
}

/** Scope both the delivery lease and its claimed notifications to the same fiber. */
export function deliverPendingNotificationsEffect(
  db: Database,
  ref: SectionRef,
  env: Pick<Env, "EMAIL" | "NOTIFICATION_FROM_EMAIL">,
): Effect.Effect<number> {
  return Effect.acquireUseRelease(
    Effect.promise(() => acquirePendingNotification(db, ref)),
    (owned) =>
      Effect.gen(function* () {
        if (!owned) return 0;

        const results = yield* sendSectionNotificationsEffect({
          db,
          ref,
          classInfo: owned.intent.class_info,
          changes: owned.intent.changes,
          emailBinding: env.EMAIL,
          fromEmail: env.NOTIFICATION_FROM_EMAIL,
          delivery: { id: owned.intent.id, leaseId: owned.leaseId },
        });

        if (results.some((r) => !r.success))
          return yield* Effect.die(new Error("Notification delivery incomplete"));
        yield* Effect.promise(() =>
          db.delete(pendingSectionNotifications).where(ownsNotification(ref, owned)),
        );

        return results.length;
      }),
    (owned) =>
      owned
        ? Effect.promise(async () => {
            await db
              .update(pendingSectionNotifications)
              .set({ lease_id: null, leased_until: null })
              .where(ownsNotification(ref, owned));
          })
        : Effect.void,
  );
}

export function deliverPendingNotifications(
  db: Database,
  ref: SectionRef,
  env: Pick<Env, "EMAIL" | "NOTIFICATION_FROM_EMAIL">,
): Promise<number> {
  return Effect.runPromise(deliverPendingNotificationsEffect(db, ref, env));
}
