import { boolean, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

import { users } from './users';

// =============================================================================
// User profiles — 1:1 with users.
// =============================================================================
// Holds admin/disabled flags, notification preferences, email engagement
// state, consent timestamps, and onboarding state. No escalation-prevention
// trigger in PlanetScale — the app layer protects privileged columns.

export const userProfiles = pgTable(
  'user_profiles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** FK to users(id). Unique — one profile per user. */
    user_id: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /**
     * Admin flag. Enforced by app-layer checks and the verifyAdmin server
     * gate, not by DB triggers.
     */
    is_admin: boolean('is_admin').notNull().default(false),
    /** CCPA soft-delete / admin disable. Disables notifications and blocks sign-in. */
    is_disabled: boolean('is_disabled').notNull().default(false),
    disabled_at: timestamp('disabled_at', { withTimezone: true, mode: 'string' }),
    /** Master notification opt-in. Default TRUE. Used by is_watcher_eligible. */
    notifications_enabled: boolean('notifications_enabled').notNull().default(true),
    /** When the user unsubscribed via email link. Non-NULL suppresses notifications. */
    unsubscribed_at: timestamp('unsubscribed_at', { withTimezone: true, mode: 'string' }),
    /** TRUE when a sent email bounced. Bounced watchers are excluded by is_watcher_eligible. */
    email_bounced: boolean('email_bounced').notNull().default(false),
    email_bounced_at: timestamp('email_bounced_at', { withTimezone: true, mode: 'string' }),
    /** TRUE when a spam complaint was recorded. Excluded by is_watcher_eligible. */
    spam_complained: boolean('spam_complained').notNull().default(false),
    spam_complained_at: timestamp('spam_complained_at', { withTimezone: true, mode: 'string' }),
    /** When the user confirmed they are 18+. Required for consent gate. */
    age_verified_at: timestamp('age_verified_at', { withTimezone: true, mode: 'string' }),
    /** When the user agreed to the Terms of Service. Required for consent gate. */
    agreed_to_terms_at: timestamp('agreed_to_terms_at', { withTimezone: true, mode: 'string' }),
    /** When the user finished onboarding (e.g. created first watch). NULL means pending. */
    onboarding_completed_at: timestamp('onboarding_completed_at', {
      withTimezone: true,
      mode: 'string',
    }),
    /** When the user dismissed the onboarding modal. NULL means not skipped. */
    onboarding_skipped_at: timestamp('onboarding_skipped_at', {
      withTimezone: true,
      mode: 'string',
    }),
    created_at: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow(),
    /** Last modification timestamp. App layer should update on every change. */
    updated_at: timestamp('updated_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow(),
  },
  (t) => [unique('user_profiles_user_id_key').on(t.user_id)]
);

/** Row type inferred from the user_profiles table (select). */
export type UserProfile = typeof userProfiles.$inferSelect;
/** Insert type inferred from the user_profiles table. */
export type NewUserProfile = typeof userProfiles.$inferInsert;
