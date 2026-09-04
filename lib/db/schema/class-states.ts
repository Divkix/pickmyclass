import { index, integer, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

export const classStates = pgTable(
  'class_states',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    class_nbr: text('class_nbr').notNull(),
    term: text('term').notNull(),
    subject: text('subject').notNull(),
    catalog_nbr: text('catalog_nbr').notNull(),
    title: text('title'),
    instructor_name: text('instructor_name'),
    seats_available: integer('seats_available').notNull().default(0),
    seats_capacity: integer('seats_capacity').notNull().default(0),
    non_reserved_seats: integer('non_reserved_seats'),
    location: text('location'),
    meeting_times: text('meeting_times'),
    last_checked_at: timestamp('last_checked_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow(),
    last_changed_at: timestamp('last_changed_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow(),
    consecutive_not_found_count: integer('consecutive_not_found_count').notNull().default(0),
  },
  (t) => [
    unique('class_states_class_nbr_term_key').on(t.class_nbr, t.term),
    index('idx_class_states_class_nbr').on(t.class_nbr),
    index('idx_class_states_subject').on(t.subject),
  ]
);

export type ClassState = typeof classStates.$inferSelect;
export type NewClassState = typeof classStates.$inferInsert;
