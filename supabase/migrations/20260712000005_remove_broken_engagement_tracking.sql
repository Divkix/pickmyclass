-- Remove the incomplete email-open engagement subsystem.
--
-- The app records successful sends but has no open webhook or tracking pixel
-- (and the privacy policy explicitly promises no tracking pixels). As a result,
-- every recipient eventually looked disengaged and could be auto-disabled after
-- seven delivered messages. Restore only users disabled by this subsystem while
-- preserving manual unsubscribes, bounces, spam complaints, and disabled accounts.

UPDATE public.user_profiles
SET
  notifications_enabled = CASE
    WHEN unsubscribed_at IS NULL
      AND email_bounced = FALSE
      AND spam_complained = FALSE
      AND is_disabled = FALSE
    THEN TRUE
    ELSE notifications_enabled
  END,
  engagement_disabled_at = NULL
WHERE engagement_disabled_at IS NOT NULL;

-- Replace the eligibility helper without the nonexistent engagement signal.
CREATE OR REPLACE FUNCTION private.is_watcher_eligible(
  p_notifications_enabled BOOLEAN,
  p_email_bounced BOOLEAN,
  p_spam_complained BOOLEAN,
  p_is_disabled BOOLEAN
)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT
    COALESCE(p_notifications_enabled, TRUE)
    AND NOT COALESCE(p_email_bounced, FALSE)
    AND NOT COALESCE(p_spam_complained, FALSE)
    AND NOT COALESCE(p_is_disabled, FALSE);
$$;

COMMENT ON FUNCTION private.is_watcher_eligible(BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN)
IS 'Authoritative watcher eligibility policy shared by all pipeline, admin, and popularity queries.';

REVOKE ALL ON FUNCTION private.is_watcher_eligible(BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_sections_to_check(stagger_type TEXT)
RETURNS TABLE (
  class_nbr TEXT,
  term TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
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
$$;

COMMENT ON FUNCTION public.get_sections_to_check(TEXT)
IS 'Returns distinct watched sections whose owners are currently eligible for notifications, optionally partitioned by class-number parity.';

CREATE OR REPLACE FUNCTION public.get_watchers_for_sections(section_numbers TEXT[], p_term TEXT)
RETURNS TABLE (
  user_id UUID,
  email TEXT,
  watch_id UUID,
  class_nbr TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    cw.user_id,
    u.email::TEXT,
    cw.id AS watch_id,
    cw.class_nbr
  FROM public.class_watches cw
  INNER JOIN auth.users u ON u.id = cw.user_id
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
$$;

COMMENT ON FUNCTION public.get_watchers_for_sections(TEXT[], TEXT)
IS 'Returns notification-eligible watchers for the requested section numbers in exactly one term.';

CREATE OR REPLACE FUNCTION public.get_class_watchers(p_class_nbr TEXT, p_term TEXT)
RETURNS TABLE (
  user_id UUID,
  email TEXT,
  watch_id UUID,
  created_at TIMESTAMPTZ
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    cw.user_id,
    u.email::TEXT,
    cw.id AS watch_id,
    cw.created_at
  FROM public.class_watches cw
  INNER JOIN auth.users u ON u.id = cw.user_id
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
$$;

COMMENT ON FUNCTION public.get_class_watchers(TEXT, TEXT)
IS 'Returns notification-eligible watchers for exactly one class-number and term pair.';

CREATE OR REPLACE FUNCTION public.get_most_watched_class(p_term TEXT)
RETURNS TABLE (
  class_nbr TEXT,
  term TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
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
$$;

COMMENT ON FUNCTION public.get_most_watched_class(TEXT)
IS 'Returns the most-watched notification-eligible section in one term, with a deterministic class-number tiebreaker.';

DROP FUNCTION private.is_watcher_eligible(BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN, TIMESTAMPTZ);

-- Keep the profile-escalation trigger aligned before removing the dead columns.
CREATE OR REPLACE FUNCTION public.prevent_user_profile_escalation()
RETURNS TRIGGER AS $$
BEGIN
  IF current_user IN ('service_role', 'supabase_admin', 'postgres') THEN
    RETURN NEW;
  END IF;

  NEW.is_admin := OLD.is_admin;
  NEW.is_disabled := OLD.is_disabled;
  NEW.disabled_at := OLD.disabled_at;
  NEW.email_bounced := OLD.email_bounced;
  NEW.email_bounced_at := OLD.email_bounced_at;
  NEW.spam_complained := OLD.spam_complained;
  NEW.spam_complained_at := OLD.spam_complained_at;
  NEW.age_verified_at := OLD.age_verified_at;
  NEW.agreed_to_terms_at := OLD.agreed_to_terms_at;
  NEW.onboarding_completed_at := OLD.onboarding_completed_at;
  NEW.onboarding_skipped_at := OLD.onboarding_skipped_at;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Recreate the admin user page without fabricated open-rate fields. The
-- notification status is derived from authoritative account/delivery state.
DROP FUNCTION public.get_users_page(INTEGER, INTEGER, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT);

CREATE FUNCTION public.get_users_page(
  p_page        INTEGER DEFAULT 1,
  p_page_size   INTEGER DEFAULT 25,
  p_search      TEXT DEFAULT '',
  p_role        TEXT DEFAULT 'all',
  p_verified    TEXT DEFAULT 'all',
  p_watch_count TEXT DEFAULT 'all',
  p_sort        TEXT DEFAULT 'created_at',
  p_dir         TEXT DEFAULT 'desc'
)
RETURNS TABLE (
  id                  UUID,
  email               TEXT,
  created_at          TIMESTAMPTZ,
  last_sign_in_at     TIMESTAMPTZ,
  email_confirmed_at  TIMESTAMPTZ,
  watch_count         BIGINT,
  is_admin            BOOLEAN,
  seat_emails         BIGINT,
  instructor_emails   BIGINT,
  notification_status TEXT,
  total_count         BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
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
    FROM auth.users u
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
$$;

COMMENT ON FUNCTION public.get_users_page(INTEGER, INTEGER, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT)
IS 'Paginated admin user listing with authoritative notification status. Sort keys are selected through static CASE expressions.';

REVOKE EXECUTE ON FUNCTION public.get_users_page(INTEGER, INTEGER, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.get_users_page(INTEGER, INTEGER, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO service_role;

-- Remove orphaned APIs and the misleading engagement storage.
DROP FUNCTION IF EXISTS public.record_engagement_send_batch(UUID[]);
DROP FUNCTION IF EXISTS public.record_engagement_send(UUID);
DROP FUNCTION IF EXISTS public.record_engagement_open(UUID);
DROP FUNCTION IF EXISTS public.get_user_engagement_stats();
DROP FUNCTION IF EXISTS public.get_notification_counts_by_class();
DROP FUNCTION IF EXISTS public.get_notification_counts_by_user();
DROP FUNCTION IF EXISTS public.try_record_notification(UUID, TEXT, INTEGER);
DROP FUNCTION IF EXISTS public.user_owns_class_watch(UUID);

DROP INDEX IF EXISTS public.idx_user_profiles_engagement;

ALTER TABLE public.user_profiles
  DROP COLUMN engagement_emails_sent,
  DROP COLUMN engagement_emails_opened,
  DROP COLUMN engagement_window_start,
  DROP COLUMN engagement_last_opened_at,
  DROP COLUMN engagement_disabled_at;
