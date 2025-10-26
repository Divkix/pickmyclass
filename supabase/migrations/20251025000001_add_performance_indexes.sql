-- Performance Indexes for Query Optimization
-- Purpose: Speed up stagger filtering, bulk queries, and class state lookups

-- Index 1: Composite index for class_nbr and term lookups
-- Used by get_sections_to_check() and general section queries
CREATE INDEX IF NOT EXISTS idx_class_watches_class_nbr_term
  ON public.class_watches(class_nbr, term);

COMMENT ON INDEX public.idx_class_watches_class_nbr_term IS 'Composite index for efficient section lookups in staggered cron jobs';


-- Index 2: Partial index for even-numbered sections (stagger optimization)
-- Filters sections where last digit is even (0, 2, 4, 6, 8)
CREATE INDEX IF NOT EXISTS idx_class_watches_even
  ON public.class_watches(class_nbr, term)
  WHERE (CAST(SUBSTRING(class_nbr FROM LENGTH(class_nbr) FOR 1) AS INTEGER) % 2) = 0;

COMMENT ON INDEX public.idx_class_watches_even IS 'Partial index for even-numbered sections (:00 and :30 minute cron runs)';


-- Index 3: Partial index for odd-numbered sections (stagger optimization)
-- Filters sections where last digit is odd (1, 3, 5, 7, 9)
CREATE INDEX IF NOT EXISTS idx_class_watches_odd
  ON public.class_watches(class_nbr, term)
  WHERE (CAST(SUBSTRING(class_nbr FROM LENGTH(class_nbr) FOR 1) AS INTEGER) % 2) = 1;

COMMENT ON INDEX public.idx_class_watches_odd IS 'Partial index for odd-numbered sections (future expansion for more frequent checks)';


-- Index 4: Composite index on class_states for change tracking queries
-- Used when querying recently checked/changed classes
CREATE INDEX IF NOT EXISTS idx_class_states_last_checked_changed
  ON public.class_states(last_checked_at DESC, last_changed_at DESC);

COMMENT ON INDEX public.idx_class_states_last_checked_changed IS 'Composite index for efficient queries on check and change timestamps';


-- Index 5: Covering index for notification deduplication checks
-- Speeds up "has notification been sent" queries
CREATE INDEX IF NOT EXISTS idx_notifications_sent_watch_type
  ON public.notifications_sent(class_watch_id, notification_type, sent_at DESC);

COMMENT ON INDEX public.idx_notifications_sent_watch_type IS 'Covering index for fast notification deduplication with expiration checks';
