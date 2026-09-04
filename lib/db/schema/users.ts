import { pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

export const users = pgTable(
  'users',
  {
    id: text('id').primaryKey(),
    clerk_user_id: text('clerk_user_id'),
    email: text('email').notNull(),
    email_confirmed_at: timestamp('email_confirmed_at', { withTimezone: true, mode: 'string' }),
    created_at: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow(),
    last_sign_in_at: timestamp('last_sign_in_at', { withTimezone: true, mode: 'string' }),
  },
  (t) => [uniqueIndex('idx_users_clerk_user_id').on(t.clerk_user_id)]
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
