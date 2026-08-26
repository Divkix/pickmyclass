import { index, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

import { users } from './users';

// =============================================================================
// Class watches — user subscriptions to Class Sections.
// =============================================================================
// A user watches a section for seat/instructor notifications; a user can watch
// a section once per term (user_id, class_nbr, term).

export const classWatches = pgTable(
  'class_watches',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** FK to users(id). Clerk user id. */
    user_id: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** ASU class number being watched. Paired with term. */
    class_nbr: text('class_nbr').notNull(),
    /** ASU term code being watched. Paired with class_nbr. */
    term: text('term').notNull(),
    subject: text('subject').notNull(),
    catalog_nbr: text('catalog_nbr').notNull(),
    created_at: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique('class_watches_user_id_class_nbr_term_key').on(t.user_id, t.class_nbr, t.term),
    index('idx_class_watches_user_id').on(t.user_id),
    index('idx_class_watches_class_nbr').on(t.class_nbr),
    index('idx_class_watches_created_at').on(t.created_at.desc()),
  ]
);

/** Row type inferred from the class_watches table (select). */
export type ClassWatch = typeof classWatches.$inferSelect;
/** Insert type inferred from the class_watches table. */
export type NewClassWatch = typeof classWatches.$inferInsert;
