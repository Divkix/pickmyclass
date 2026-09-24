-- Claim ids come back with the insert, and a slower section check cannot
-- overwrite a newer observation.
--
-- 1. try_record_notifications_batch used to return watch ids. Rollback then
--    looked up the active row for those watches, which after a reset and a
--    newer claim is a different row. RETURNING the inserted notification id
--    lets rollback delete that row only.
-- 2. upsert_class_state_locked locked only the write, then always replaced
--    seats and cleared consecutive_not_found_count. An older ASU observation
--    that commits later clobbered a newer one and reset the strike counter.
--    The write now applies only when p_observed_at is at least last_checked_at.
-- 3. The BEFORE UPDATE trigger forced last_checked_at = NOW(), which made the
--    comparison commit order again. Writers set last_checked_at themselves.

DROP FUNCTION IF EXISTS public.try_record_notifications_batch(UUID[], TEXT, INTEGER);

CREATE FUNCTION public.try_record_notifications_batch(
  p_class_watch_ids    UUID[],
  p_notification_type  TEXT,
  p_expires_hours      INTEGER DEFAULT 24
)
RETURNS TABLE (notification_id UUID, class_watch_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_watch_id UUID;
  v_notification_id UUID;
BEGIN
  IF p_notification_type NOT IN ('seat_available', 'instructor_assigned') THEN
    RAISE EXCEPTION 'Invalid notification_type: %', p_notification_type;
  END IF;

  IF p_expires_hours < 1 OR p_expires_hours > 168 THEN
    RAISE EXCEPTION 'Invalid p_expires_hours: %', p_expires_hours;
  END IF;

  FOREACH v_watch_id IN ARRAY p_class_watch_ids
  LOOP
    BEGIN
      PERFORM 1 FROM public.notifications_sent
      WHERE notifications_sent.class_watch_id = v_watch_id
        AND notifications_sent.notification_type = p_notification_type
        AND notifications_sent.is_active = TRUE
      LIMIT 1;

      IF NOT FOUND THEN
        INSERT INTO public.notifications_sent (
          class_watch_id, notification_type, sent_at, expires_at
        ) VALUES (
          v_watch_id, p_notification_type, NOW(),
          NOW() + (p_expires_hours || ' hours')::INTERVAL
        )
        RETURNING id INTO v_notification_id;

        notification_id := v_notification_id;
        class_watch_id := v_watch_id;
        RETURN NEXT;
      END IF;

    EXCEPTION
      WHEN unique_violation THEN
        NULL;
      WHEN foreign_key_violation THEN
        NULL;
    END;
  END LOOP;
END;
$$;

COMMENT ON FUNCTION public.try_record_notifications_batch(UUID[], TEXT, INTEGER)
IS 'Atomically claims dedup slots for a batch of watch IDs. Returns one row per new claim: the notification row id (the only id rollback may delete) and the watch id (who to email). A slot is occupied iff an is_active = TRUE row exists. Vanished watches are skipped.';

DROP FUNCTION IF EXISTS public.upsert_class_state_locked(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, INTEGER, INTEGER, TEXT, TEXT
);

CREATE FUNCTION public.upsert_class_state_locked(
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
  p_meeting_times      TEXT,
  p_observed_at        TIMESTAMPTZ
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_last_checked_at TIMESTAMPTZ;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(p_class_nbr || '|' || p_term));

  SELECT last_checked_at
    INTO v_last_checked_at
  FROM public.class_states
  WHERE class_nbr = p_class_nbr AND term = p_term;

  IF FOUND AND v_last_checked_at IS NOT NULL AND v_last_checked_at > p_observed_at THEN
    RETURN FALSE;
  END IF;

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
    p_observed_at,
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
    last_checked_at            = EXCLUDED.last_checked_at,
    consecutive_not_found_count = 0;

  RETURN TRUE;
END;
$$;

COMMENT ON FUNCTION public.upsert_class_state_locked(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, INTEGER, INTEGER, TEXT, TEXT, TIMESTAMPTZ)
IS 'Upserts one class_states row under a SectionRef advisory lock. Returns false, and writes nothing, when last_checked_at is already later than p_observed_at. An applied write stores p_observed_at and resets consecutive_not_found_count.';

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

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.update_class_state_changed_at()
IS 'Moves class_states.last_changed_at when seats or instructor change. Does not touch last_checked_at: the writer supplies the observation time, and NOW() here would make a later commit look newer than an earlier observation.';
