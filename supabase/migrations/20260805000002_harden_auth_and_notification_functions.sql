-- Harden auth and notification functions.
--
-- Three related hardening fixes:
--  1. increment_failed_attempts: SECURITY DEFINER owned by postgres that never
--     pinned search_path, so a caller-controlled search_path could redirect its
--     unqualified `failed_login_attempts` references to hostile objects. Add
--     `SET search_path = public` (body otherwise identical to 20260504120000) and
--     re-assert the service_role-only grant.
--  2. expire_stale_notifications: created in 20260521000000 with only a GRANT to
--     service_role, so PUBLIC (hence anon/authenticated) kept the implicit EXECUTE
--     granted at function creation. Anyone could flip expired dedup rows to
--     is_active = FALSE; this is load-bearing for the dedup lifecycle and must be
--     service_role-only. Revoke and re-issue the grant.
--  3. delete_notification_records: its DELETE had no is_active filter, so the
--     failed-send rollback also erased historical (expired/inactive) notification
--     rows, drifting admin email counts. The dedup claim always lives on a freshly
--     inserted is_active = TRUE row (see try_record_notifications_batch), so
--     restricting the DELETE to active rows still unsuppresses the failed batch
--     while preserving history.

-- 1. increment_failed_attempts: add SET search_path = public.
CREATE OR REPLACE FUNCTION public.increment_failed_attempts(
  p_email TEXT,
  p_max_attempts INTEGER DEFAULT 5,
  p_lockout_minutes INTEGER DEFAULT 15
)
RETURNS TABLE (attempts INTEGER, locked BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_attempts INTEGER;
  v_locked_until TIMESTAMPTZ;
  v_now TIMESTAMPTZ := NOW();
BEGIN
  -- Atomic insert or increment
  INSERT INTO failed_login_attempts (email, attempts, last_attempt_at, locked_until)
  VALUES (p_email, 1, v_now, NULL)
  ON CONFLICT (email) DO UPDATE SET
    attempts = failed_login_attempts.attempts + 1,
    last_attempt_at = v_now,
    -- Lock if attempts reach max (minus 1 because we're about to increment)
    locked_until = CASE
      WHEN failed_login_attempts.attempts + 1 >= p_max_attempts
      THEN v_now + (p_lockout_minutes || ' minutes')::INTERVAL
      ELSE NULL
    END
  RETURNING failed_login_attempts.attempts, failed_login_attempts.locked_until INTO v_attempts, v_locked_until;

  RETURN QUERY SELECT v_attempts, (v_locked_until IS NOT NULL AND v_locked_until > v_now);
END;
$$;

-- Re-assert service_role-only execution (mirrors 20260504120000).
REVOKE EXECUTE ON FUNCTION public.increment_failed_attempts(TEXT, INTEGER, INTEGER) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.increment_failed_attempts(TEXT, INTEGER, INTEGER) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.increment_failed_attempts(TEXT, INTEGER, INTEGER) TO service_role;

-- 2. expire_stale_notifications: revoke the default PUBLIC execute.
REVOKE EXECUTE ON FUNCTION public.expire_stale_notifications() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_stale_notifications() TO service_role;

-- 3. delete_notification_records: only roll back active dedup claims.
CREATE OR REPLACE FUNCTION public.delete_notification_records(
  p_class_watch_ids UUID[],
  p_notification_type TEXT
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

  DELETE FROM public.notifications_sent
  WHERE class_watch_id = ANY(p_class_watch_ids)
    AND notification_type = p_notification_type
    AND is_active = TRUE;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

-- Re-assert service_role-only execution (mirrors 20260501000000).
REVOKE EXECUTE ON FUNCTION public.delete_notification_records(UUID[], TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.delete_notification_records(UUID[], TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.delete_notification_records(UUID[], TEXT) TO service_role;
