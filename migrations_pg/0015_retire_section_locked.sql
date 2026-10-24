-- Additive: the old Worker can continue serving while this migration applies.
-- Always returns one row. A missing/reset state returns false, zero, NULL, [].
-- A retirement returns the deleted-watch count, class metadata and eligible
-- recipients from exactly the watches deleted by this transaction.
CREATE FUNCTION public.retire_section_locked(
  p_class_nbr text, p_term text, p_threshold integer,
  OUT retired boolean, OUT watches_deleted integer,
  OUT class_info jsonb, OUT watchers jsonb
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_state public.class_states%ROWTYPE;
BEGIN
  retired := FALSE;
  watches_deleted := 0;
  class_info := NULL;
  watchers := '[]'::jsonb;

  PERFORM pg_advisory_xact_lock(hashtext(p_class_nbr || '|' || p_term));
  SELECT * INTO v_state FROM public.class_states
    WHERE class_nbr = p_class_nbr AND term = p_term FOR UPDATE;
  IF NOT FOUND OR v_state.consecutive_not_found_count < p_threshold THEN
    RETURN;
  END IF;

  WITH deleted AS (
    DELETE FROM public.class_watches
      WHERE class_nbr = p_class_nbr AND term = p_term
      RETURNING id, user_id, created_at
  ), eligible AS (
    SELECT d.user_id, u.email::text AS email, d.id AS watch_id, d.created_at
    FROM deleted d
    JOIN public.users u ON u.id = d.user_id
    LEFT JOIN public.user_profiles up ON up.user_id = d.user_id
    WHERE private.is_watcher_eligible(
      up.notifications_enabled, up.email_bounced, up.spam_complained, up.is_disabled
    )
  )
  SELECT (SELECT count(*)::integer FROM deleted),
    COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'user_id', e.user_id, 'email', e.email, 'watch_id', e.watch_id
    ) ORDER BY e.created_at, e.watch_id) FROM eligible e), '[]'::jsonb)
  INTO watches_deleted, watchers;

  DELETE FROM public.class_states WHERE class_nbr = p_class_nbr AND term = p_term;
  class_info := jsonb_build_object(
    'subject', v_state.subject, 'catalog_nbr', v_state.catalog_nbr, 'title', v_state.title
  );
  retired := TRUE;
END;
$$;
