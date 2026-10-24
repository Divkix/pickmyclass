import { sql } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "@/lib/db";
import type { ClaimedNotification } from "@/lib/db/queries";
import type { SectionRef } from "@/lib/section-ref";
import type { ClassDetails } from "@/lib/types/class";
import type { NotificationType } from "@/lib/types/notification";

export async function resetNotificationsForSection(
  db: Database,
  ref: SectionRef,
  notificationType: NotificationType,
): Promise<void> {
  await db.execute(
    sql`SELECT public.reset_section_notifications(${ref.class_nbr}::text, ${ref.term}::text, ${notificationType}::text)`,
  );
}

export async function deleteNotificationRecords(
  db: Database,
  watchIds: string[],
  notificationType: NotificationType,
): Promise<number> {
  if (watchIds.length === 0) return 0;

  const idParams = watchIds.map((id) => sql`${id}::uuid`);

  const { rows } = await db.execute<{ deleted: number }>(
    sql`SELECT public.delete_notification_records(ARRAY[${sql.join(idParams, sql`, `)}], ${notificationType}::text) AS deleted`,
  );

  return rows[0].deleted;
}

/** Exercise the legacy claim RPC directly; production delivery requires an intent lease. */
export async function tryRecordNotificationsBatch(
  db: Database,
  watchIds: string[],
  notificationType: NotificationType,
  expiresHours = 24,
): Promise<ClaimedNotification[]> {
  if (watchIds.length === 0) return [];
  const ids = watchIds.map((id) => sql`${id}::uuid`);

  const { rows } = await db.execute(sql`SELECT notification_id, class_watch_id
    FROM public.try_record_notifications_batch(ARRAY[${sql.join(ids, sql`, `)}], ${notificationType}::text, ${expiresHours}::integer)`);

  return z
    .array(z.object({ notification_id: z.string().min(1), class_watch_id: z.string().min(1) }))
    .parse(rows)
    .map((row) => ({ notificationId: row.notification_id, watchId: row.class_watch_id }));
}

export async function upsertClassState(
  db: Database,
  ref: SectionRef,
  details: ClassDetails,
  observedAt: Date,
): Promise<boolean> {
  const { rows } = await db.execute<{ applied: boolean }>(
    sql`SELECT public.upsert_class_state_locked(
      ${ref.class_nbr}::text,
      ${ref.term}::text,
      ${details.subject}::text,
      ${details.catalog_nbr}::text,
      ${details.title}::text,
      ${details.instructor_name || null}::text,
      ${details.seats_available || 0}::integer,
      ${details.seats_capacity || 0}::integer,
      ${details.non_reserved_seats ?? null}::integer,
      ${details.location || null}::text,
      ${details.meeting_times || null}::text,
      ${observedAt.toISOString()}::timestamptz
    ) AS applied`,
  );

  return rows[0].applied;
}
