import { sql } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "@/lib/db";
import type { ClaimedNotification } from "@/lib/db/queries";
import type { NotificationType } from "@/lib/types/notification";

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
