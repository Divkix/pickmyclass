import { integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

// =============================================================================
// Failed login attempts — per-email lockout tracker.
// =============================================================================
// PK is the lowercased email (lowercased by the app before any auth/lockout op).

export const failedLoginAttempts = pgTable('failed_login_attempts', {
  email: text('email').primaryKey(),
  attempts: integer('attempts'),
  last_attempt_at: timestamp('last_attempt_at', { withTimezone: true, mode: 'string' }),
  /** When the lockout expires. NULL or past means not locked. */
  locked_until: timestamp('locked_until', { withTimezone: true, mode: 'string' }),
});

/** Row type inferred from the failed_login_attempts table (select). */
export type FailedLoginAttempt = typeof failedLoginAttempts.$inferSelect;
/** Insert type inferred from the failed_login_attempts table. */
export type NewFailedLoginAttempt = typeof failedLoginAttempts.$inferInsert;
