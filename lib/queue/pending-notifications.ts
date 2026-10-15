import { randomUUID } from "node:crypto";
import { and, eq, isNull, lt, or, sql } from "drizzle-orm";
import { z } from "zod";
import { NOTIFICATION_LEASE_SECONDS } from "@/lib/config";
import type { Database } from "@/lib/db";
import { driverErrorMessage } from "@/lib/db/pg-errors";
import { pendingSectionNotifications } from "@/lib/db/schema";
import { sendSectionNotifications } from "@/lib/queue/notification-sender";
import type { SectionRef } from "@/lib/section-ref";
import type { ClassDetails } from "@/lib/types/class";
import type { Env } from "@/lib/types/env";

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

/** Resume the saved transition before the cycle guard can acknowledge redelivery. */
export async function deliverPendingNotifications(
  db: Database,
  ref: SectionRef,
  env: Pick<Env, "EMAIL" | "NOTIFICATION_FROM_EMAIL">,
): Promise<number> {
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

  if (!pending) return 0;

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

  if (!owned) throw new Error("Notification delivery is already in progress");

  const ownership = and(
    forSection(ref),
    eq(pendingSectionNotifications.id, owned.id),
    eq(pendingSectionNotifications.lease_id, leaseId),
  );

  try {
    const results = await sendSectionNotifications({
      db,
      ref,
      classInfo: owned.class_info,
      changes: owned.changes,
      emailBinding: env.EMAIL,
      fromEmail: env.NOTIFICATION_FROM_EMAIL,
      delivery: { id: owned.id, leaseId },
    });

    if (results.some((r) => !r.success)) throw new Error("Notification delivery incomplete");
    await db.delete(pendingSectionNotifications).where(ownership);

    return results.length;
  } finally {
    // Ownership comparison prevents a stale delivery from releasing its replacement.
    await db
      .update(pendingSectionNotifications)
      .set({ lease_id: null, leased_until: null })
      .where(ownership);
  }
}
