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

// =============================================================================
// Notifications sent — notification dedup log.
// =============================================================================
// The partial unique index unique_notification_active is the load-bearing
// dedup backbone: only rows with is_active = TRUE occupy a dedup slot. The
// daily expire_stale_notifications sweep flips expired active rows to
// inactive, freeing slots for re-notification. Failed sends are rolled back
// via delete_notification_records so users are not suppressed for the 24h
// window.

export const notificationsSent = pgTable(
  'notifications_sent',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** FK to class_watches(id). Cascades on watch deletion. */
    class_watch_id: uuid('class_watch_id')
      .notNull()
      .references(() => classWatches.id, { onDelete: 'cascade' }),
    /** Always exactly seat_available or instructor_assigned. */
    notification_type: text('notification_type').notNull(),
    sent_at: timestamp('sent_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
    /**
     * When this dedup slot expires. expire_stale_notifications flips is_active
     * to FALSE past this time.
     */
    expires_at: timestamp('expires_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .default(sql`NOW() + INTERVAL '24 hours'`),
    /** TRUE means the dedup slot is occupied. The partial unique index only covers active rows. */
    is_active: boolean('is_active').notNull().default(true),
  },
  (t) => [
    check(
      'notifications_sent_notification_type_check',
      sql`${t.notification_type} IN ('seat_available', 'instructor_assigned')`
    ),
    // One active notification per (watch, type) — the dedup backbone.
    uniqueIndex('unique_notification_active')
      .on(t.class_watch_id, t.notification_type)
      .where(sql`${t.is_active} = TRUE`),
    index('idx_notifications_sent_sent_at').on(t.sent_at.desc()),
  ]
);

/** Row type inferred from the notifications_sent table (select). */
export type NotificationSent = typeof notificationsSent.$inferSelect;
/** Insert type inferred from the notifications_sent table. */
export type NewNotificationSent = typeof notificationsSent.$inferInsert;
