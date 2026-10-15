CREATE FUNCTION public.claim_section_notifications(
  p_watch_ids uuid[], p_type text, p_intent uuid, p_lease uuid
) RETURNS TABLE(notification_id uuid, class_watch_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_claim record;
BEGIN
  -- Lock ownership for the duration of claiming so an expired owner cannot
  -- claim against an intent that another delivery has taken over or deleted.
  PERFORM 1 FROM public.pending_section_notifications
    WHERE id = p_intent AND lease_id = p_lease AND leased_until > now()
    FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Notification intent ownership lost'; END IF;

  FOR v_claim IN SELECT * FROM public.try_record_notifications_batch(p_watch_ids, p_type, 24)
  LOOP
    UPDATE public.notifications_sent n SET delivery_intent_id = p_intent
      WHERE n.id = v_claim.notification_id;
  END LOOP;

  RETURN QUERY SELECT n.id, n.class_watch_id FROM public.notifications_sent n
    WHERE n.delivery_intent_id = p_intent AND n.class_watch_id = ANY(p_watch_ids)
      AND n.notification_type = p_type AND n.is_active AND n.delivered_at IS NULL;
END;
$$;
