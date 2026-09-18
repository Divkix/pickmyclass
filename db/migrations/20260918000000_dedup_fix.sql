-- Notification dedup race fixes.
--
-- 1. try_record_notifications_batch: existence predicate was `expires_at > NOW()`
--    while the dedup index is partial on `is_active = TRUE`. The two disagree for
--    exactly as long as an expired row is still is_active (the window between
--    expires_at and the next expire_stale_notifications sweep): the claim sees "no
--    active row", tries to INSERT, and the partial unique index rejects it — so nobody
--    is notified and the watch stays suppressed until the sweep runs. Match the index
--    predicate and let expire_stale_notifications free the slot.
-- 2. try_record_notifications_batch: the watch row can be deleted mid-claim (cascade
--    from deleteSectionAndWatches). The INSERT then raises foreign_key_violation,
--    which used to abort the whole batch and surface as a 500 / retry storm. Treat a
--    vanished watch as a skipped watch, exactly like a lost dedup race.
-- 3. reset_section_notifications: a single join-scoped DELETE replaces the
--    SELECT-then-DELETE in resetNotificationsForSection. The stale watch-id list could
--    outlive a watch row that moved to another section, deleting a foreign active
--    claim; scoping the join at DELETE time cannot.
-- 4. delete_notification_records_by_ids: row-id-scoped rollback so a failed send erases
--    exactly the row it claimed, never a newer claim that replaced it in the meantime.
--    Active-only, matching delete_notification_records — history rows stay intact.

CREATE OR REPLACE FUNCTION public.try_record_notifications_batch(
  p_class_watch_ids    UUID[],
  p_notification_type  TEXT,
  p_expires_hours      INTEGER DEFAULT 24
)
RETURNS UUID[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_recorded_ids UUID[] := '{}';
  v_watch_id UUID;
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
      WHERE class_watch_id = v_watch_id
        AND notification_type = p_notification_type
        AND is_active = TRUE
      LIMIT 1;

      IF NOT FOUND THEN
        INSERT INTO public.notifications_sent (
          class_watch_id, notification_type, sent_at, expires_at
        ) VALUES (
          v_watch_id, p_notification_type, NOW(),
          NOW() + (p_expires_hours || ' hours')::INTERVAL
        );
        v_recorded_ids := array_append(v_recorded_ids, v_watch_id);
      END IF;

    EXCEPTION
      WHEN unique_violation THEN
        NULL;
      WHEN foreign_key_violation THEN
        NULL;
    END;
  END LOOP;

  RETURN v_recorded_ids;
END;
$$;

COMMENT ON FUNCTION public.try_record_notifications_batch(UUID[], TEXT, INTEGER)
IS 'Atomically claims dedup slots for a batch of watch IDs. A slot is occupied iff an is_active = TRUE row exists — the same predicate as unique_notification_active — so a claim loss is always a caught unique_violation, never a doomed insert. Vanished watches (foreign_key_violation) are skipped. Returns only the newly-claimed IDs; that set is the authorization to email.';

-- No REVOKE/GRANT below: the base schema (20260822000000) targets PlanetScale, which has
-- no anon/authenticated/service_role roles, so every migration after it must apply on a
-- role-less cluster (same as 20260904000000). PUBLIC keeps its default EXECUTE.

CREATE OR REPLACE FUNCTION public.reset_section_notifications(
  p_class_nbr          TEXT,
  p_term               TEXT,
  p_notification_type  TEXT
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted INTEGER;
BEGIN
  IF p_notification_type NOT IN ('seat_available', 'instructor_assigned') THEN
    RAISE EXCEPTION 'Invalid notification_type: %', p_notification_type;
  END IF;

  DELETE FROM public.notifications_sent ns
  USING public.class_watches cw
  WHERE cw.id = ns.class_watch_id
    AND cw.class_nbr = p_class_nbr
    AND cw.term = p_term
    AND ns.notification_type = p_notification_type
    AND ns.is_active = TRUE;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

COMMENT ON FUNCTION public.reset_section_notifications(TEXT, TEXT, TEXT)
IS 'Frees active dedup slots for one notification type across every watch of a section (class_nbr + term), so a reverse change can re-notify. Join-scoped and active-only: never touches another section''s claim, never erases history rows.';

CREATE OR REPLACE FUNCTION public.delete_notification_records_by_ids(
  p_notification_ids UUID[]
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted INTEGER;
BEGIN
  DELETE FROM public.notifications_sent
  WHERE id = ANY(p_notification_ids)
    AND is_active = TRUE;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

COMMENT ON FUNCTION public.delete_notification_records_by_ids(UUID[])
IS 'Rolls back failed email sends by notification row id. Deletes only is_active = TRUE rows, so a send failure cannot erase a newer claim that replaced the one it held, and history rows survive.';
