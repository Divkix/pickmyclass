import { pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

// =============================================================================
// Users — mirror of Clerk-managed identities, synced via Clerk webhooks.
// =============================================================================
// Replaces Supabase auth.users. `id` is the Clerk user id (TEXT); migrated
// rows are keyed by the old Supabase UUID via Clerk's externalId.

export const users = pgTable(
  'users',
  {
    /**
     * Stable app user id. Migrated rows keyed by old Supabase UUID via Clerk
     * externalId; post-cutover users keyed by Clerk user id.
     */
    id: text('id').primaryKey(),
    /**
     * Clerk user id (sub claim). Populated by webhook sync; lets user.deleted
     * (which carries only the Clerk id) resolve migrated rows.
     */
    clerk_user_id: text('clerk_user_id'),
    email: text('email').notNull(),
    /** When the user confirmed their email address. NULL means unconfirmed. */
    email_confirmed_at: timestamp('email_confirmed_at', { withTimezone: true, mode: 'string' }),
    created_at: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow(),
    /** Timestamp of the most recent sign-in. NULL if never signed in. */
    last_sign_in_at: timestamp('last_sign_in_at', { withTimezone: true, mode: 'string' }),
  },
  (t) => [uniqueIndex('idx_users_clerk_user_id').on(t.clerk_user_id)]
);

/** Row type inferred from the users table (select). */
export type User = typeof users.$inferSelect;
/** Insert type inferred from the users table. */
export type NewUser = typeof users.$inferInsert;
