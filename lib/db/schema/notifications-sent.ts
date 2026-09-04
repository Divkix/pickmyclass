import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { classWatches } from './class-watches';

export const notificationsSent = pgTable(
  'notifications_sent',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    class_watch_id: uuid('class_watch_id')
      .notNull()
      .references(() => classWatches.id, { onDelete: 'cascade' }),
    notification_type: text('notification_type').notNull(),
    sent_at: timestamp('sent_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
    expires_at: timestamp('expires_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .default(sql`NOW() + INTERVAL '24 hours'`),
    is_active: boolean('is_active').notNull().default(true),
  },
  (t) => [
    check(
      'notifications_sent_notification_type_check',
      sql`${t.notification_type} IN ('seat_available', 'instructor_assigned')`
    ),
    uniqueIndex('unique_notification_active')
      .on(t.class_watch_id, t.notification_type)
      .where(sql`${t.is_active} = TRUE`),
    index('idx_notifications_sent_sent_at').on(t.sent_at.desc()),
  ]
);

export type NotificationSent = typeof notificationsSent.$inferSelect;
export type NewNotificationSent = typeof notificationsSent.$inferInsert;
