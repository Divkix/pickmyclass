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
    AND notification_type = p_notification_type;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_notification_records(UUID[], TEXT) TO service_role;
