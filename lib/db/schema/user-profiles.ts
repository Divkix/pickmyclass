import { boolean, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

import { users } from './users';

export const userProfiles = pgTable(
  'user_profiles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    user_id: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    is_admin: boolean('is_admin').notNull().default(false),
    is_disabled: boolean('is_disabled').notNull().default(false),
    disabled_at: timestamp('disabled_at', { withTimezone: true, mode: 'string' }),
    notifications_enabled: boolean('notifications_enabled').notNull().default(true),
    unsubscribed_at: timestamp('unsubscribed_at', { withTimezone: true, mode: 'string' }),
    email_bounced: boolean('email_bounced').notNull().default(false),
    email_bounced_at: timestamp('email_bounced_at', { withTimezone: true, mode: 'string' }),
    spam_complained: boolean('spam_complained').notNull().default(false),
    spam_complained_at: timestamp('spam_complained_at', { withTimezone: true, mode: 'string' }),
    age_verified_at: timestamp('age_verified_at', { withTimezone: true, mode: 'string' }),
    agreed_to_terms_at: timestamp('agreed_to_terms_at', { withTimezone: true, mode: 'string' }),
    onboarding_completed_at: timestamp('onboarding_completed_at', {
      withTimezone: true,
      mode: 'string',
    }),
    onboarding_skipped_at: timestamp('onboarding_skipped_at', {
      withTimezone: true,
      mode: 'string',
    }),
    created_at: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow(),
  },
  (t) => [unique('user_profiles_user_id_key').on(t.user_id)]
);

export type UserProfile = typeof userProfiles.$inferSelect;
export type NewUserProfile = typeof userProfiles.$inferInsert;
