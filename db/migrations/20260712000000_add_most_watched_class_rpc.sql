-- get_most_watched_class: most-watched SectionRef for a given term (onboarding
-- "popular class" example, issue #300).
--
-- Returns the single (class_nbr, term) section with the most active watchers for
-- the supplied term, so the first-step onboarding modal can offer a real
-- "Track this class" shortcut instead of a text-only guide.
--
-- Watcher-eligibility filters MUST stay in sync with get_sections_to_check,
-- get_watchers_for_sections, and get_class_watchers:
--   notifications_enabled, NOT email_bounced, NOT spam_complained,
--   NOT is_disabled, engagement_disabled_at IS NULL.
-- Only active watchers count toward "most watched" — a section watched only by
-- disabled/bounced/spam/engagement-disabled users is not popular.
--
-- SECURITY DEFINER so it can join auth.users-free data; locked to service_role
-- because the watcher count is an aggregate over the whole user base (not safe
-- to expose per-user via RLS). The API route validates the result against the
-- ASU API before showing it, so a stale/404 section never reaches the modal.

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
    AND COALESCE(up.notifications_enabled, true) = true
    AND COALESCE(up.email_bounced, false) = false
    AND COALESCE(up.spam_complained, false) = false
    AND COALESCE(up.is_disabled, false) = false
    AND up.engagement_disabled_at IS NULL
  GROUP BY cw.class_nbr, cw.term
  ORDER BY COUNT(*) DESC, cw.class_nbr ASC
  LIMIT 1;
$$;

COMMENT ON FUNCTION public.get_most_watched_class(TEXT) IS 'Returns the single most-watched Class Section (class_nbr + term) for the given term, counting only active watchers (notifications enabled, not bounced/spam/disabled/engagement-disabled). Used by the onboarding popular-class example.';

REVOKE EXECUTE ON FUNCTION public.get_most_watched_class(TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_most_watched_class(TEXT) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.get_most_watched_class(TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_most_watched_class(TEXT) TO service_role;
