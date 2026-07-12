-- Centralize watcher eligibility so section enumeration, notification
-- recipients, admin/DLQ watcher counts, and onboarding popularity cannot drift.

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC;
REVOKE ALL ON SCHEMA private FROM anon;
REVOKE ALL ON SCHEMA private FROM authenticated;

CREATE OR REPLACE FUNCTION private.is_watcher_eligible(
  p_notifications_enabled BOOLEAN,
  p_email_bounced BOOLEAN,
  p_spam_complained BOOLEAN,
  p_is_disabled BOOLEAN,
  p_engagement_disabled_at TIMESTAMPTZ
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
    AND NOT COALESCE(p_is_disabled, FALSE)
    AND p_engagement_disabled_at IS NULL;
$$;

COMMENT ON FUNCTION private.is_watcher_eligible(BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN, TIMESTAMPTZ)
IS 'Authoritative watcher eligibility policy shared by all pipeline, admin, and popularity queries.';

REVOKE ALL ON FUNCTION private.is_watcher_eligible(BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN, TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.is_watcher_eligible(BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN, TIMESTAMPTZ) FROM anon;
REVOKE ALL ON FUNCTION private.is_watcher_eligible(BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN, TIMESTAMPTZ) FROM authenticated;
REVOKE ALL ON FUNCTION private.is_watcher_eligible(BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN, TIMESTAMPTZ) FROM service_role;

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
    up.is_disabled,
    up.engagement_disabled_at
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
IS 'Returns distinct class sections to check by stagger group, using the authoritative watcher eligibility policy.';

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
      up.is_disabled,
      up.engagement_disabled_at
    )
  ORDER BY cw.class_nbr, cw.user_id;
$$;

COMMENT ON FUNCTION public.get_watchers_for_sections(TEXT[], TEXT)
IS 'Returns notification recipients for SectionRefs in one term, using the authoritative watcher eligibility policy.';

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
      up.is_disabled,
      up.engagement_disabled_at
    )
  ORDER BY cw.created_at;
$$;

COMMENT ON FUNCTION public.get_class_watchers(TEXT, TEXT)
IS 'Returns watchers for one SectionRef with creation timestamps, using the authoritative watcher eligibility policy.';

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
      up.is_disabled,
      up.engagement_disabled_at
    )
  GROUP BY cw.class_nbr, cw.term
  ORDER BY COUNT(*) DESC, cw.class_nbr ASC
  LIMIT 1;
$$;

COMMENT ON FUNCTION public.get_most_watched_class(TEXT)
IS 'Returns the most-watched SectionRef for a term, counting only watchers allowed by the authoritative eligibility policy.';

REVOKE EXECUTE ON FUNCTION public.get_sections_to_check(TEXT) FROM PUBLIC, authenticated, anon;
REVOKE EXECUTE ON FUNCTION public.get_watchers_for_sections(TEXT[], TEXT) FROM PUBLIC, authenticated, anon;
REVOKE EXECUTE ON FUNCTION public.get_class_watchers(TEXT, TEXT) FROM PUBLIC, authenticated, anon;
REVOKE EXECUTE ON FUNCTION public.get_most_watched_class(TEXT) FROM PUBLIC, authenticated, anon;

GRANT EXECUTE ON FUNCTION public.get_sections_to_check(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_watchers_for_sections(TEXT[], TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_class_watchers(TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_most_watched_class(TEXT) TO service_role;
