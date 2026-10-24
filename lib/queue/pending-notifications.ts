import { randomUUID } from "node:crypto";
import { Data } from "effect";
import { and, eq, isNull, lt, or, sql } from "drizzle-orm";
import { z } from "zod";
import { NOTIFICATION_LEASE_SECONDS } from "@/lib/config";
import type { Database } from "@/lib/db";
import { driverErrorMessage } from "@/lib/db/pg-errors";
import { errorFields, log } from "@/lib/log";
import { pendingSectionNotifications } from "@/lib/db/schema";
import { sendSectionNotifications } from "@/lib/queue/notification-sender";
import { type SectionRef, sectionFields } from "@/lib/section-ref";
import type { ClassDetails } from "@/lib/types/class";
import type { Env } from "@/lib/types/env";

export class NotificationLeaseBusy extends Error {
  constructor(public retryAfterSeconds: number) {
    super("Notification delivery is already in progress");
  }
}

export class NotificationDeliveryIncomplete extends Data.TaggedError(
  "NotificationDeliveryIncomplete",
)<{
  message: string;
  retryable: true;
  cause?: Error;
}> {}

const recordedSchema = z
  .object({ applied: z.boolean(), intent_created: z.boolean() })
  .transform((row) => ({ applied: row.applied, intentCreated: row.intent_created }));

export type RecordedSectionCheck = z.infer<typeof recordedSchema>;

/** `intentCreated`: this observation saved a pending intent that still needs delivery. */
export async function recordSectionCheck(
  db: Database,
  ref: SectionRef,
  details: ClassDetails,
  observedAt: Date,
): Promise<RecordedSectionCheck> {
  try {
    const { rows } = await db.execute(sql`SELECT applied, intent_created
    FROM public.record_section_observation(${ref.class_nbr}::text, ${ref.term}::text,
    ${JSON.stringify(details)}::jsonb, ${observedAt.toISOString()}::timestamptz)`);

    return recordedSchema.parse(rows[0]);
  } catch (error) {
    throw new Error(`Failed to record section check: ${driverErrorMessage(error)}`, {
      cause: error,
    });
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

/** Deliver the section's pending intent under a lease released on every exit path. */
export async function deliverPendingNotifications(
  db: Database,
  ref: SectionRef,
  env: Pick<Env, "EMAIL" | "NOTIFICATION_FROM_EMAIL">,
): Promise<number> {
  const owned = await acquirePendingNotification(db, ref);

  if (!owned) return 0;

  let deleted = false;

  try {
    const results = await sendSectionNotifications({
      db,
      ref,
      classInfo: owned.intent.class_info,
      changes: owned.intent.changes,
      emailBinding: env.EMAIL,
      fromEmail: env.NOTIFICATION_FROM_EMAIL,
      delivery: { id: owned.intent.id, leaseId: owned.leaseId },
    });

    const failures = results.filter((result) => !result.success);

    for (const failure of failures)
      log("PendingNotifications").error("Notification delivery failed", {
        ...sectionFields(ref),
        intent_id: owned.intent.id,
        watch_id: failure.watchId,
        notification_type: failure.type,
        "email.code": failure.code,
        retryable: failure.retryable,
        ...errorFields(failure.cause ?? new Error(failure.error)),
      });

    const retry = failures.find((failure) => failure.retryable !== false || failure.outcomeUnknown);

    if (retry)
      throw new NotificationDeliveryIncomplete({
        message: "Notification delivery incomplete",
        retryable: true,
        cause: retry.cause,
      });
    await db.delete(pendingSectionNotifications).where(ownsNotification(ref, owned));
    deleted = true;

    return results.length - failures.length;
  } finally {
    // Deleting the row already released the lease; only a failed delete needs
    // the update. A failed release must not mask the delivery error.
    if (!deleted) {
      try {
        await db
          .update(pendingSectionNotifications)
          .set({ lease_id: null, leased_until: null })
          .where(ownsNotification(ref, owned));
      } catch (error) {
        log("PendingNotifications").warn("Failed to release notification lease", {
          ...sectionFields(ref),
          ...errorFields(error),
        });
      }
    }
  }
}
