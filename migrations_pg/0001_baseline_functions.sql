-- Functions, schema and trigger dumped from production (pg_get_functiondef) when
-- db/migrations/ was retired; tables come from 0000_baseline.
CREATE SCHEMA private;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION private.is_watcher_eligible(p_notifications_enabled boolean, p_email_bounced boolean, p_spam_complained boolean, p_is_disabled boolean)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $function$
  SELECT
    COALESCE(p_notifications_enabled, TRUE)
    AND NOT COALESCE(p_email_bounced, FALSE)
    AND NOT COALESCE(p_spam_complained, FALSE)
    AND NOT COALESCE(p_is_disabled, FALSE);
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.update_class_state_changed_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF OLD.seats_available    IS DISTINCT FROM NEW.seats_available
     OR OLD.non_reserved_seats IS DISTINCT FROM NEW.non_reserved_seats
     OR OLD.instructor_name IS DISTINCT FROM NEW.instructor_name THEN
    NEW.last_changed_at = NOW();
  END IF;

  RETURN NEW;
END;
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.accept_terms_and_verify_age(p_user_id text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_consent_time TIMESTAMPTZ := NOW();
BEGIN
  UPDATE public.user_profiles
  SET age_verified_at    = COALESCE(age_verified_at, v_consent_time),
      agreed_to_terms_at = COALESCE(agreed_to_terms_at, v_consent_time)
  WHERE user_id = p_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'User profile not found';
  END IF;
END;
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.count_all_users()
 RETURNS bigint
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COUNT(*) FROM public.user_profiles;
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.count_distinct_classes_watched()
 RETURNS bigint
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COUNT(DISTINCT class_nbr) FROM public.class_watches;
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.create_class_watch_with_limit(p_user_id text, p_term text, p_subject text, p_catalog_nbr text, p_class_nbr text, p_max_watches integer)
 RETURNS class_watches
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_current_count INTEGER;
  v_watch public.class_watches;
BEGIN
  IF p_max_watches < 1 THEN
    RAISE EXCEPTION 'Invalid watch limit: %', p_max_watches;
  END IF;

  -- Serialize watch creation per user to avoid race conditions.
  PERFORM pg_advisory_xact_lock(('x' || SUBSTRING(md5(p_user_id), 1, 16))::BIT(64)::BIGINT);

  SELECT COUNT(*)
  INTO v_current_count
  FROM public.class_watches
  WHERE user_id = p_user_id;

  IF v_current_count >= p_max_watches THEN
    RAISE EXCEPTION 'MAX_WATCHES_EXCEEDED'
      USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.class_watches (
    user_id,
    term,
    subject,
    catalog_nbr,
    class_nbr
  )
  VALUES (
    p_user_id,
    p_term,
    p_subject,
    p_catalog_nbr,
    p_class_nbr
  )
  RETURNING * INTO v_watch;

  RETURN v_watch;
END;
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.delete_notification_records(p_class_watch_ids uuid[], p_notification_type text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.delete_notification_records_by_ids(p_notification_ids uuid[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_deleted INTEGER;
BEGIN
  DELETE FROM public.notifications_sent
  WHERE id = ANY(p_notification_ids)
    AND is_active = TRUE;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.expire_stale_notifications()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_count INTEGER;
BEGIN
  UPDATE public.notifications_sent
  SET is_active = FALSE
  WHERE is_active = TRUE AND expires_at IS NOT NULL AND expires_at <= NOW();
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.get_class_watchers(p_class_nbr text, p_term text)
 RETURNS TABLE(user_id text, email text, watch_id uuid, created_at timestamp with time zone)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    cw.user_id,
    u.email::TEXT,
    cw.id AS watch_id,
    cw.created_at
  FROM public.class_watches cw
  INNER JOIN public.users u ON u.id = cw.user_id
  LEFT JOIN public.user_profiles up ON up.user_id = cw.user_id
  WHERE cw.class_nbr = p_class_nbr
    AND cw.term = p_term
    AND private.is_watcher_eligible(
      up.notifications_enabled,
      up.email_bounced,
      up.spam_complained,
      up.is_disabled
    )
  ORDER BY cw.created_at;
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.get_classes_page(p_page integer DEFAULT 1, p_page_size integer DEFAULT 25, p_search text DEFAULT ''::text, p_subject text DEFAULT 'all'::text, p_seat_status text DEFAULT 'all'::text, p_instructor text DEFAULT 'all'::text, p_watcher_count text DEFAULT 'all'::text, p_sort text DEFAULT 'watcher_count'::text, p_dir text DEFAULT 'desc'::text)
 RETURNS TABLE(id text, class_nbr text, term text, subject text, catalog_nbr text, title text, instructor_name text, seats_available integer, seats_capacity integer, non_reserved_seats integer, location text, meeting_times text, last_checked_at timestamp with time zone, last_changed_at timestamp with time zone, watcher_count bigint, seat_emails bigint, instructor_emails bigint, total_count bigint, total_watchers bigint, full_classes bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH params AS (
    SELECT
      GREATEST(1, LEAST(200, COALESCE(p_page_size, 25))) AS page_size,
      (GREATEST(1, COALESCE(p_page, 1)) - 1)
        * GREATEST(1, LEAST(200, COALESCE(p_page_size, 25))) AS page_offset,
      CASE lower(COALESCE(p_sort, 'watcher_count'))
        WHEN 'class_nbr' THEN 'class_nbr'
        WHEN 'subject' THEN 'subject'
        WHEN 'seats_available' THEN 'seats_available'
        WHEN 'seat_emails' THEN 'seat_emails'
        WHEN 'instructor_emails' THEN 'instructor_emails'
        WHEN 'last_checked_at' THEN 'last_checked_at'
        ELSE 'watcher_count'
      END AS sort_key,
      lower(COALESCE(p_dir, 'desc')) = 'asc' AS sort_ascending
  ),
  base AS (
    SELECT
      cs.id::TEXT AS id,
      cs.class_nbr,
      cs.term,
      cs.subject,
      cs.catalog_nbr,
      cs.title,
      cs.instructor_name,
      cs.seats_available,
      cs.seats_capacity,
      cs.non_reserved_seats,
      cs.location,
      cs.meeting_times,
      cs.last_checked_at,
      cs.last_changed_at,
      COALESCE(wc.watcher_count, 0) AS watcher_count,
      COALESCE(nc.seat_emails, 0) AS seat_emails,
      COALESCE(nc.instructor_emails, 0) AS instructor_emails
    FROM public.class_states cs
    LEFT JOIN (
      SELECT class_nbr, term, COUNT(*) AS watcher_count
      FROM public.class_watches
      GROUP BY class_nbr, term
    ) wc ON wc.class_nbr = cs.class_nbr AND wc.term = cs.term
    LEFT JOIN (
      SELECT
        cw.class_nbr,
        cw.term,
        COUNT(*) FILTER (WHERE ns.notification_type = 'seat_available') AS seat_emails,
        COUNT(*) FILTER (WHERE ns.notification_type = 'instructor_assigned') AS instructor_emails
      FROM public.notifications_sent ns
      INNER JOIN public.class_watches cw ON cw.id = ns.class_watch_id
      GROUP BY cw.class_nbr, cw.term
    ) nc ON nc.class_nbr = cs.class_nbr AND nc.term = cs.term
    WHERE (
      COALESCE(p_search, '') = ''
      OR cs.class_nbr ILIKE '%' || p_search || '%'
      OR cs.title ILIKE '%' || p_search || '%'
    )
      AND (COALESCE(p_subject, 'all') = 'all' OR cs.subject = p_subject)
      AND (
        COALESCE(p_seat_status, 'all') = 'all'
        OR (p_seat_status = 'full' AND cs.seats_available = 0)
        OR (
          p_seat_status = 'limited'
          AND cs.seats_available > 0
          AND cs.seats_capacity > 0
          AND cs.seats_available::NUMERIC / cs.seats_capacity::NUMERIC < 0.2
        )
        OR (
          p_seat_status = 'available'
          AND cs.seats_capacity > 0
          AND cs.seats_available::NUMERIC / cs.seats_capacity::NUMERIC >= 0.2
        )
      )
      AND (
        COALESCE(p_instructor, 'all') = 'all'
        OR (
          p_instructor = 'staff'
          AND (cs.instructor_name IS NULL OR cs.instructor_name = 'Staff')
        )
        OR (
          p_instructor = 'named'
          AND cs.instructor_name IS NOT NULL
          AND cs.instructor_name <> 'Staff'
        )
      )
      AND (
        COALESCE(p_watcher_count, 'all') = 'all'
        OR (p_watcher_count = 'none' AND COALESCE(wc.watcher_count, 0) = 0)
        OR (p_watcher_count = '1-5' AND COALESCE(wc.watcher_count, 0) BETWEEN 1 AND 5)
        OR (p_watcher_count = '6-10' AND COALESCE(wc.watcher_count, 0) BETWEEN 6 AND 10)
        OR (p_watcher_count = '10+' AND COALESCE(wc.watcher_count, 0) > 10)
      )
  )
  SELECT
    base.*,
    COUNT(*) OVER () AS total_count,
    COALESCE(SUM(base.watcher_count) OVER (), 0)::BIGINT AS total_watchers,
    COUNT(*) FILTER (WHERE base.seats_available = 0) OVER () AS full_classes
  FROM base
  CROSS JOIN params
  ORDER BY
    CASE WHEN params.sort_key = 'class_nbr' AND params.sort_ascending THEN base.class_nbr END ASC NULLS LAST,
    CASE WHEN params.sort_key = 'class_nbr' AND NOT params.sort_ascending THEN base.class_nbr END DESC NULLS LAST,
    CASE WHEN params.sort_key = 'subject' AND params.sort_ascending THEN base.subject END ASC NULLS LAST,
    CASE WHEN params.sort_key = 'subject' AND NOT params.sort_ascending THEN base.subject END DESC NULLS LAST,
    CASE WHEN params.sort_key = 'seats_available' AND params.sort_ascending THEN base.seats_available END ASC NULLS LAST,
    CASE WHEN params.sort_key = 'seats_available' AND NOT params.sort_ascending THEN base.seats_available END DESC NULLS LAST,
    CASE WHEN params.sort_key = 'watcher_count' AND params.sort_ascending THEN base.watcher_count END ASC NULLS LAST,
    CASE WHEN params.sort_key = 'watcher_count' AND NOT params.sort_ascending THEN base.watcher_count END DESC NULLS LAST,
    CASE WHEN params.sort_key = 'seat_emails' AND params.sort_ascending THEN base.seat_emails END ASC NULLS LAST,
    CASE WHEN params.sort_key = 'seat_emails' AND NOT params.sort_ascending THEN base.seat_emails END DESC NULLS LAST,
    CASE WHEN params.sort_key = 'instructor_emails' AND params.sort_ascending THEN base.instructor_emails END ASC NULLS LAST,
    CASE WHEN params.sort_key = 'instructor_emails' AND NOT params.sort_ascending THEN base.instructor_emails END DESC NULLS LAST,
    CASE WHEN params.sort_key = 'last_checked_at' AND params.sort_ascending THEN base.last_checked_at END ASC NULLS LAST,
    CASE WHEN params.sort_key = 'last_checked_at' AND NOT params.sort_ascending THEN base.last_checked_at END DESC NULLS LAST,
    base.class_nbr,
    base.term,
    base.id
  LIMIT (SELECT page_size FROM params)
  OFFSET (SELECT page_offset FROM params);
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.get_distinct_subjects()
 RETURNS TABLE(subject text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT DISTINCT subject FROM public.class_states ORDER BY subject;
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.get_most_watched_class(p_term text)
 RETURNS TABLE(class_nbr text, term text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    cw.class_nbr,
    cw.term
  FROM public.class_watches cw
  LEFT JOIN public.user_profiles up ON up.user_id = cw.user_id
  WHERE cw.term = p_term
    AND private.is_watcher_eligible(
      up.notifications_enabled,
      up.email_bounced,
      up.spam_complained,
      up.is_disabled
    )
  GROUP BY cw.class_nbr, cw.term
  ORDER BY COUNT(*) DESC, cw.class_nbr ASC
  LIMIT 1;
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.get_recent_activity(p_limit integer DEFAULT 50)
 RETURNS TABLE(activity_type text, activity_at timestamp with time zone, user_email text, class_nbr text, subject text, catalog_nbr text, notification_type text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  (
    SELECT
      'user_registration'::TEXT AS activity_type,
      u.created_at AS activity_at,
      u.email::TEXT AS user_email,
      NULL::TEXT AS class_nbr,
      NULL::TEXT AS subject,
      NULL::TEXT AS catalog_nbr,
      NULL::TEXT AS notification_type
    FROM public.users u
    ORDER BY u.created_at DESC
  )
  UNION ALL
  (
    SELECT
      'new_watch'::TEXT AS activity_type,
      cw.created_at AS activity_at,
      u.email::TEXT AS user_email,
      cw.class_nbr,
      cw.subject,
      cw.catalog_nbr,
      NULL::TEXT AS notification_type
    FROM public.class_watches cw
    INNER JOIN public.users u ON u.id = cw.user_id
    ORDER BY cw.created_at DESC
  )
  UNION ALL
  (
    SELECT
      'email_sent'::TEXT AS activity_type,
      ns.sent_at AS activity_at,
      u.email::TEXT AS user_email,
      cw.class_nbr,
      cw.subject,
      cw.catalog_nbr,
      ns.notification_type::TEXT
    FROM public.notifications_sent ns
    INNER JOIN public.class_watches cw ON cw.id = ns.class_watch_id
    INNER JOIN public.users u ON u.id = cw.user_id
    ORDER BY ns.sent_at DESC
  )
  ORDER BY activity_at DESC
  LIMIT p_limit;
END;
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.get_sections_to_check(stagger_type text)
 RETURNS TABLE(class_nbr text, term text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT DISTINCT
    cw.class_nbr,
    cw.term
  FROM public.class_watches cw
  LEFT JOIN public.user_profiles up ON up.user_id = cw.user_id
  WHERE private.is_watcher_eligible(
    up.notifications_enabled,
    up.email_bounced,
    up.spam_complained,
    up.is_disabled
  )
    AND CASE
      WHEN stagger_type = 'even' THEN
        (CAST(SUBSTRING(cw.class_nbr FROM LENGTH(cw.class_nbr) FOR 1) AS INTEGER) % 2) = 0
      WHEN stagger_type = 'odd' THEN
        (CAST(SUBSTRING(cw.class_nbr FROM LENGTH(cw.class_nbr) FOR 1) AS INTEGER) % 2) = 1
      ELSE TRUE
    END
  ORDER BY cw.class_nbr;
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.get_users_page(p_page integer DEFAULT 1, p_page_size integer DEFAULT 25, p_search text DEFAULT ''::text, p_role text DEFAULT 'all'::text, p_verified text DEFAULT 'all'::text, p_watch_count text DEFAULT 'all'::text, p_sort text DEFAULT 'created_at'::text, p_dir text DEFAULT 'desc'::text)
 RETURNS TABLE(id text, email text, created_at timestamp with time zone, last_sign_in_at timestamp with time zone, email_confirmed_at timestamp with time zone, watch_count bigint, is_admin boolean, seat_emails bigint, instructor_emails bigint, notification_status text, total_count bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH params AS (
    SELECT
      GREATEST(1, LEAST(200, COALESCE(p_page_size, 25))) AS page_size,
      (GREATEST(1, COALESCE(p_page, 1)) - 1)
        * GREATEST(1, LEAST(200, COALESCE(p_page_size, 25))) AS page_offset,
      CASE lower(COALESCE(p_sort, 'created_at'))
        WHEN 'email' THEN 'email'
        WHEN 'last_sign_in_at' THEN 'last_sign_in_at'
        WHEN 'watch_count' THEN 'watch_count'
        WHEN 'seat_emails' THEN 'seat_emails'
        WHEN 'instructor_emails' THEN 'instructor_emails'
        ELSE 'created_at'
      END AS sort_key,
      lower(COALESCE(p_dir, 'desc')) = 'asc' AS sort_ascending
  ),
  base AS (
    SELECT
      u.id,
      u.email::TEXT AS email,
      u.created_at,
      u.last_sign_in_at,
      u.email_confirmed_at,
      COALESCE(wc.watch_count, 0) AS watch_count,
      COALESCE(up.is_admin, FALSE) AS is_admin,
      COALESCE(nc.seat_emails, 0) AS seat_emails,
      COALESCE(nc.instructor_emails, 0) AS instructor_emails,
      CASE
        WHEN COALESCE(up.is_disabled, FALSE) THEN 'disabled'
        WHEN COALESCE(up.spam_complained, FALSE) THEN 'spam'
        WHEN COALESCE(up.email_bounced, FALSE) THEN 'bounced'
        WHEN NOT COALESCE(up.notifications_enabled, TRUE)
          OR up.unsubscribed_at IS NOT NULL THEN 'unsubscribed'
        ELSE 'active'
      END AS notification_status
    FROM public.users u
    LEFT JOIN (
      SELECT user_id, COUNT(*) AS watch_count
      FROM public.class_watches
      GROUP BY user_id
    ) wc ON wc.user_id = u.id
    LEFT JOIN public.user_profiles up ON up.user_id = u.id
    LEFT JOIN (
      SELECT
        cw.user_id,
        COUNT(*) FILTER (WHERE ns.notification_type = 'seat_available') AS seat_emails,
        COUNT(*) FILTER (WHERE ns.notification_type = 'instructor_assigned') AS instructor_emails
      FROM public.notifications_sent ns
      INNER JOIN public.class_watches cw ON cw.id = ns.class_watch_id
      GROUP BY cw.user_id
    ) nc ON nc.user_id = u.id
    WHERE (p_search = '' OR u.email ILIKE '%' || p_search || '%')
      AND (
        p_role = 'all'
        OR (p_role = 'admin' AND COALESCE(up.is_admin, FALSE))
        OR (p_role = 'user' AND NOT COALESCE(up.is_admin, FALSE))
      )
      AND (
        p_verified = 'all'
        OR (p_verified = 'verified' AND u.email_confirmed_at IS NOT NULL)
        OR (p_verified = 'unverified' AND u.email_confirmed_at IS NULL)
      )
      AND (
        p_watch_count = 'all'
        OR (p_watch_count = 'none' AND COALESCE(wc.watch_count, 0) = 0)
        OR (p_watch_count = '1-5' AND COALESCE(wc.watch_count, 0) BETWEEN 1 AND 5)
        OR (p_watch_count = '6-10' AND COALESCE(wc.watch_count, 0) BETWEEN 6 AND 10)
        OR (p_watch_count = '10+' AND COALESCE(wc.watch_count, 0) > 10)
      )
  )
  SELECT
    base.*,
    COUNT(*) OVER () AS total_count
  FROM base
  CROSS JOIN params
  ORDER BY
    CASE WHEN params.sort_key = 'email' AND params.sort_ascending THEN base.email END ASC NULLS LAST,
    CASE WHEN params.sort_key = 'email' AND NOT params.sort_ascending THEN base.email END DESC NULLS LAST,
    CASE WHEN params.sort_key = 'last_sign_in_at' AND params.sort_ascending THEN base.last_sign_in_at END ASC NULLS LAST,
    CASE WHEN params.sort_key = 'last_sign_in_at' AND NOT params.sort_ascending THEN base.last_sign_in_at END DESC NULLS LAST,
    CASE WHEN params.sort_key = 'watch_count' AND params.sort_ascending THEN base.watch_count END ASC NULLS LAST,
    CASE WHEN params.sort_key = 'watch_count' AND NOT params.sort_ascending THEN base.watch_count END DESC NULLS LAST,
    CASE WHEN params.sort_key = 'seat_emails' AND params.sort_ascending THEN base.seat_emails END ASC NULLS LAST,
    CASE WHEN params.sort_key = 'seat_emails' AND NOT params.sort_ascending THEN base.seat_emails END DESC NULLS LAST,
    CASE WHEN params.sort_key = 'instructor_emails' AND params.sort_ascending THEN base.instructor_emails END ASC NULLS LAST,
    CASE WHEN params.sort_key = 'instructor_emails' AND NOT params.sort_ascending THEN base.instructor_emails END DESC NULLS LAST,
    CASE WHEN params.sort_key = 'created_at' AND params.sort_ascending THEN base.created_at END ASC NULLS LAST,
    CASE WHEN params.sort_key = 'created_at' AND NOT params.sort_ascending THEN base.created_at END DESC NULLS LAST,
    base.id
  LIMIT (SELECT page_size FROM params)
  OFFSET (SELECT page_offset FROM params);
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.get_watchers_for_sections(section_numbers text[], p_term text)
 RETURNS TABLE(user_id text, email text, watch_id uuid, class_nbr text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    cw.user_id,
    u.email::TEXT,
    cw.id AS watch_id,
    cw.class_nbr
  FROM public.class_watches cw
  INNER JOIN public.users u ON u.id = cw.user_id
  LEFT JOIN public.user_profiles up ON up.user_id = cw.user_id
  WHERE cw.class_nbr = ANY(section_numbers)
    AND cw.term = p_term
    AND private.is_watcher_eligible(
      up.notifications_enabled,
      up.email_bounced,
      up.spam_complained,
      up.is_disabled
    )
  ORDER BY cw.class_nbr, cw.user_id;
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.increment_consecutive_not_found(p_class_nbr text, p_term text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.increment_failed_attempts(p_email text, p_max_attempts integer DEFAULT 5, p_lockout_minutes integer DEFAULT 15)
 RETURNS TABLE(attempts integer, locked boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_attempts INTEGER;
  v_locked_until TIMESTAMPTZ;
  v_now TIMESTAMPTZ := NOW();
BEGIN
  -- Atomic insert or increment.
  INSERT INTO failed_login_attempts (email, attempts, last_attempt_at, locked_until)
  VALUES (p_email, 1, v_now, NULL)
  ON CONFLICT (email) DO UPDATE SET
    attempts = failed_login_attempts.attempts + 1,
    last_attempt_at = v_now,
    -- Lock if attempts reach max.
    locked_until = CASE
      WHEN failed_login_attempts.attempts + 1 >= p_max_attempts
      THEN v_now + (p_lockout_minutes || ' minutes')::INTERVAL
      ELSE NULL
    END
  RETURNING failed_login_attempts.attempts, failed_login_attempts.locked_until
    INTO v_attempts, v_locked_until;

  RETURN QUERY SELECT v_attempts, (v_locked_until IS NOT NULL AND v_locked_until > v_now);
END;
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.reset_section_notifications(p_class_nbr text, p_term text, p_notification_type text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.skip_onboarding(p_user_id text)
 RETURNS TABLE(onboarding_completed_at timestamp with time zone, onboarding_skipped_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.user_profiles
    SET onboarding_skipped_at = NOW()
    WHERE user_id = p_user_id
      AND onboarding_completed_at IS NULL
      AND onboarding_skipped_at IS NULL;

  RETURN QUERY
    SELECT up.onboarding_completed_at, up.onboarding_skipped_at
    FROM public.user_profiles up
    WHERE up.user_id = p_user_id;
END;
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.try_record_notifications_batch(p_class_watch_ids uuid[], p_notification_type text, p_expires_hours integer DEFAULT 24)
 RETURNS TABLE(notification_id uuid, class_watch_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.upsert_class_state_locked(p_class_nbr text, p_term text, p_subject text, p_catalog_nbr text, p_title text, p_instructor_name text, p_seats_available integer, p_seats_capacity integer, p_non_reserved_seats integer, p_location text, p_meeting_times text, p_observed_at timestamp with time zone)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;
--> statement-breakpoint
CREATE TRIGGER trigger_update_class_state_changed_at BEFORE UPDATE ON public.class_states FOR EACH ROW EXECUTE FUNCTION update_class_state_changed_at();
