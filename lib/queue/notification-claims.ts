import { and, eq, inArray } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "@/lib/db";
import { type ClaimedNotification, tryRecordNotificationsBatch } from "@/lib/db/queries";
import { notificationsSent } from "@/lib/db/schema";
import type { NotificationType } from "@/lib/types/notification";

export interface NotificationDelivery {
  id: string;
  leaseId: string;
}

/** Existing undelivered claims for this intent are work to resume, not proof of delivery. */
export async function claimNotifications(
  db: Database,
  watchIds: string[],
  type: NotificationType,
  delivery?: NotificationDelivery,
): Promise<ClaimedNotification[]> {
  if (!delivery) return tryRecordNotificationsBatch(db, watchIds, type);

  if (watchIds.length === 0) return [];
  const ids = watchIds.map((id) => sql`${id}::uuid`);

  const { rows } =
    await db.execute(sql`SELECT notification_id, class_watch_id FROM public.claim_section_notifications(
    ARRAY[${sql.join(ids, sql`, `)}], ${type}::text, ${delivery.id}::uuid, ${delivery.leaseId}::uuid)`);

  return z
    .array(z.object({ notification_id: z.string(), class_watch_id: z.string() }))
    .parse(rows)
    .map((row) => ({ notificationId: row.notification_id, watchId: row.class_watch_id }));
}

export async function confirmNotificationDelivery(
  db: Database,
  ids: string[],
  delivery: NotificationDelivery,
): Promise<void> {
  if (ids.length === 0) return;
  await db
    .update(notificationsSent)
    .set({ delivered_at: new Date().toISOString() })
    .where(
      and(
        inArray(notificationsSent.id, ids),
        eq(notificationsSent.delivery_intent_id, delivery.id),
      ),
    );
}
