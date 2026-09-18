-- =============================================================================
-- class_states race fixes
-- =============================================================================
-- Three fixes, all DB-side so no application round trip can interleave:
--   1. upsert_class_state_locked — pipeline write path for class_states, with a
--      SectionRef-scoped advisory lock so a seed / strike / check for the same
--      (class_nbr, term) serialize instead of racing.
--   2. increment_consecutive_not_found — folded the application-side
--      "insert placeholder on Section not found" fallback (lib/db/queries.ts)
--      into a single INSERT ... ON CONFLICT DO UPDATE, so concurrent NotFound
--      calls on a missing row can no longer lose or double-count a strike.
--   3. update_class_state_changed_at — the last_changed_at trigger never made
--      it into the PlanetScale schema, and it must treat non_reserved_seats
--      (the real seat signal) as a change.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. upsert_class_state_locked
-- -----------------------------------------------------------------------------
-- Single write path for the seat-check pipeline. The advisory lock key is the
-- SectionRef, so two workers checking the same section (duplicate enqueue
-- redelivery, seed racing a check) serialize on the row instead of
-- interleaving. hashtext collisions only over-serialize — never corrupt.
CREATE OR REPLACE FUNCTION public.upsert_class_state_locked(
  p_class_nbr          TEXT,
  p_term               TEXT,
  p_subject            TEXT,
  p_catalog_nbr        TEXT,
  p_title              TEXT,
  p_instructor_name    TEXT,
  p_seats_available    INTEGER,
  p_seats_capacity     INTEGER,
  p_non_reserved_seats INTEGER,
  p_location           TEXT,
  p_meeting_times      TEXT
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(p_class_nbr || '|' || p_term));

  INSERT INTO public.class_states (
    class_nbr,
    term,
    subject,
    catalog_nbr,
    title,
    instructor_name,
    seats_available,
    seats_capacity,
    non_reserved_seats,
    location,
    meeting_times,
    last_checked_at,
    consecutive_not_found_count
  )
  VALUES (
    p_class_nbr,
    p_term,
    p_subject,
    p_catalog_nbr,
    p_title,
    p_instructor_name,
    p_seats_available,
    p_seats_capacity,
    p_non_reserved_seats,
    p_location,
    p_meeting_times,
    NOW(),
    0
  )
  ON CONFLICT (class_nbr, term) DO UPDATE SET
    subject                    = EXCLUDED.subject,
    catalog_nbr                = EXCLUDED.catalog_nbr,
    title                      = EXCLUDED.title,
    instructor_name            = EXCLUDED.instructor_name,
    seats_available            = EXCLUDED.seats_available,
    seats_capacity             = EXCLUDED.seats_capacity,
    non_reserved_seats         = EXCLUDED.non_reserved_seats,
    location                   = EXCLUDED.location,
    meeting_times              = EXCLUDED.meeting_times,
    last_checked_at            = NOW(),
    consecutive_not_found_count = 0;
END;
$$;

COMMENT ON FUNCTION public.upsert_class_state_locked(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, INTEGER, INTEGER, TEXT, TEXT)
IS 'Upserts one class_states row for a SectionRef under an advisory lock keyed on (class_nbr, term). Resets consecutive_not_found_count on both insert and conflict paths. The pipeline write path — seeds must use INSERT ... ON CONFLICT DO NOTHING instead.';

-- -----------------------------------------------------------------------------
-- 2. increment_consecutive_not_found (recreated)
-- -----------------------------------------------------------------------------
-- Previously raised 'Section not found' for a missing row, forcing the
-- application to insert a placeholder and retry on 23505 (lost/double strikes
-- under concurrency). Now a single atomic statement that creates the
-- placeholder row itself.
CREATE OR REPLACE FUNCTION public.increment_consecutive_not_found(
  p_class_nbr TEXT,
  p_term      TEXT
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new_count INTEGER;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(p_class_nbr || '|' || p_term));

  INSERT INTO public.class_states (
    class_nbr,
    term,
    subject,
    catalog_nbr,
    seats_available,
    seats_capacity,
    non_reserved_seats,
    last_checked_at,
    consecutive_not_found_count
  )
  VALUES (
    p_class_nbr,
    p_term,
    '',
    '',
    0,
    0,
    NULL,
    NOW(),
    1
  )
  ON CONFLICT (class_nbr, term) DO UPDATE SET
    consecutive_not_found_count = public.class_states.consecutive_not_found_count + 1,
    last_checked_at            = NOW()
  RETURNING consecutive_not_found_count INTO v_new_count;

  RETURN v_new_count;
END;
$$;

COMMENT ON FUNCTION public.increment_consecutive_not_found(TEXT, TEXT)
IS 'Atomically increments consecutive_not_found_count for a SectionRef, creating an empty placeholder row when the section has never been seen. Returns the new count. Never raises for a missing row — one strike per call, no lost increments under concurrent workers.';

-- -----------------------------------------------------------------------------
-- 3. update_class_state_changed_at
-- -----------------------------------------------------------------------------
-- last_changed_at must move when the seat signal moves: non_reserved_seats is
-- the signal detectChanges uses (falling back to seats_available), so a change
-- there is a change. IS DISTINCT FROM also makes a NULL instructor transition
-- count, which the old != chain only half-covered.
CREATE OR REPLACE FUNCTION public.update_class_state_changed_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.seats_available    IS DISTINCT FROM NEW.seats_available
     OR OLD.non_reserved_seats IS DISTINCT FROM NEW.non_reserved_seats
     OR OLD.instructor_name IS DISTINCT FROM NEW.instructor_name THEN
    NEW.last_changed_at = NOW();
  END IF;

  NEW.last_checked_at = NOW();

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.update_class_state_changed_at()
IS 'Keeps class_states.last_changed_at at the last seat/instructor change (seats_available, non_reserved_seats, instructor_name) and last_checked_at at the last write.';

DROP TRIGGER IF EXISTS trigger_update_class_state_changed_at ON public.class_states;

CREATE TRIGGER trigger_update_class_state_changed_at
  BEFORE UPDATE ON public.class_states
  FOR EACH ROW
  EXECUTE FUNCTION public.update_class_state_changed_at();

-- =============================================================================
-- End of class_states race fixes
-- =============================================================================
