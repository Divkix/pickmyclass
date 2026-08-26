import { index, integer, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

// =============================================================================
// Class states — cached ASU catalog state per Class Section.
// =============================================================================
// Keyed by the SectionRef (class_nbr, term): a section number repeats across
// terms, so the unique constraint spans both columns. Upserted by the
// seat-check pipeline on every check.

export const classStates = pgTable(
  'class_states',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** ASU class number (e.g. 12345). Not unique alone — paired with term for identity. */
    class_nbr: text('class_nbr').notNull(),
    /** ASU term code (e.g. 2026Fall). Paired with class_nbr for identity. */
    term: text('term').notNull(),
    subject: text('subject').notNull(),
    catalog_nbr: text('catalog_nbr').notNull(),
    title: text('title'),
    instructor_name: text('instructor_name'),
    seats_available: integer('seats_available').notNull().default(0),
    seats_capacity: integer('seats_capacity').notNull().default(0),
    /**
     * Seats available excluding waitlist reservations. Computed as
     * max(0, enrlCap - enrlTot - waitTot). NULL when no waitlist data;
     * detectChanges falls back to seats_available.
     */
    non_reserved_seats: integer('non_reserved_seats'),
    location: text('location'),
    meeting_times: text('meeting_times'),
    last_checked_at: timestamp('last_checked_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow(),
    last_changed_at: timestamp('last_changed_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow(),
    /**
     * Consecutive NotFoundError count for the SectionRef. Increments on ASU
     * 404, resets to 0 on success. Triggers auto-delete at >= 3.
     */
    consecutive_not_found_count: integer('consecutive_not_found_count').notNull().default(0),
  },
  (t) => [
    unique('class_states_class_nbr_term_key').on(t.class_nbr, t.term),
    index('idx_class_states_class_nbr').on(t.class_nbr),
    index('idx_class_states_subject').on(t.subject),
  ]
);

/** Row type inferred from the class_states table (select). */
export type ClassState = typeof classStates.$inferSelect;
/** Insert type inferred from the class_states table. */
export type NewClassState = typeof classStates.$inferInsert;
