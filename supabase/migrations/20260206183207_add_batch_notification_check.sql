CREATE OR REPLACE FUNCTION public.try_record_notifications_batch(
  p_class_watch_ids UUID[],
  p_notification_type TEXT,
  p_expires_hours INTEGER DEFAULT 24
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
        AND expires_at > NOW()
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
    END;
  END LOOP;

  RETURN v_recorded_ids;
END;
$$;

GRANT EXECUTE ON FUNCTION public.try_record_notifications_batch(UUID[], TEXT, INTEGER) TO service_role;
