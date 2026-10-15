import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { classWatches } from "./class-watches";

export const notificationsSent = pgTable(
  "notifications_sent",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    class_watch_id: uuid("class_watch_id").notNull(),
    notification_type: text("notification_type").notNull(),
    sent_at: timestamp("sent_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
    expires_at: timestamp("expires_at", { withTimezone: true, mode: "string" })
      .notNull()
      .default(sql`NOW() + INTERVAL '24 hours'`),
    is_active: boolean("is_active").notNull().default(true),
    delivery_intent_id: uuid("delivery_intent_id"),
    delivered_at: timestamp("delivered_at", { withTimezone: true, mode: "string" }),
  },
  (t) => [
    foreignKey({
      name: "notifications_sent_class_watch_id_fkey",
      columns: [t.class_watch_id],
      foreignColumns: [classWatches.id],
    }).onDelete("cascade"),
    check(
      "notifications_sent_notification_type_check",
      sql`${t.notification_type} IN ('seat_available', 'instructor_assigned')`,
    ),
    uniqueIndex("unique_notification_active")
      .on(t.class_watch_id, t.notification_type)
      .where(sql`${t.is_active} = TRUE`),
    index("idx_notifications_sent_class_watch_id").on(t.class_watch_id),
    index("idx_notifications_sent_sent_at").on(t.sent_at.desc().nullsFirst()),
    index("idx_notifications_delivery_intent")
      .on(t.delivery_intent_id)
      .where(sql`${t.delivery_intent_id} IS NOT NULL`),
  ],
);

export type NotificationSent = typeof notificationsSent.$inferSelect;

export type NewNotificationSent = typeof notificationsSent.$inferInsert;
