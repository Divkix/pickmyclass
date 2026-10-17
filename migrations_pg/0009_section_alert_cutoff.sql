-- Last America/Phoenix day a section is still checked: ASU's add deadline
-- ("last day to register or add without college approval") plus a grace
-- period, never past the class's end date. NULL when either date is unknown.
CREATE FUNCTION public.section_alert_cutoff(p_start date, p_end date) RETURNS date
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
DECLARE
  -- Classes longer than this (days) are full-semester sessions.
  full_session_min_days CONSTANT integer := 70;
  full_session_add_days CONSTANT integer := 6;
  short_session_add_days CONSTANT integer := 1;
  -- Most post-deadline seat emails went out within two weeks of the deadline.
  grace_days CONSTANT integer := 14;
BEGIN
  -- LEAST() skips NULLs, so an unknown date must short-circuit explicitly.
  IF p_start IS NULL OR p_end IS NULL THEN RETURN NULL; END IF;
  RETURN LEAST(p_end, p_start + grace_days + CASE
    WHEN p_end - p_start > full_session_min_days THEN full_session_add_days
    ELSE short_session_add_days END);
END;
$$;
--> statement-breakpoint
-- Unknown dates never end alerts, so sections keep being checked as before.
CREATE FUNCTION public.section_alerts_ended(p_start date, p_end date, p_now timestamptz DEFAULT now())
RETURNS boolean LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT COALESCE(
    public.section_alert_cutoff(p_start, p_end) < (p_now AT TIME ZONE 'America/Phoenix')::date,
    false);
$$;
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
  LEFT JOIN public.class_states cs ON cs.class_nbr = cw.class_nbr AND cs.term = cw.term
  WHERE private.is_watcher_eligible(
    up.notifications_enabled,
    up.email_bounced,
    up.spam_complained,
    up.is_disabled
  )
    AND NOT public.section_alerts_ended(cs.start_date, cs.end_date)
    AND CASE
      WHEN stagger_type = 'even' THEN
        (CAST(SUBSTRING(cw.class_nbr FROM LENGTH(cw.class_nbr) FOR 1) AS INTEGER) % 2) = 0
      WHEN stagger_type = 'odd' THEN
        (CAST(SUBSTRING(cw.class_nbr FROM LENGTH(cw.class_nbr) FOR 1) AS INTEGER) % 2) = 1
      ELSE TRUE
    END
  ORDER BY cw.class_nbr;
$function$;
