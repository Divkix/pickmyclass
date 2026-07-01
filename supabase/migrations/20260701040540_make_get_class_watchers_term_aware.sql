-- Make get_class_watchers term-aware (fourth SectionRef site).
--
-- get_class_watchers filtered by class_nbr alone. Because a section number
-- repeats across terms, the admin class-detail Watchers table over-listed
-- watchers across terms and the DLQ alert's "Watchers Affected" count was
-- inflated. A Class Section's identity is the SectionRef {class_nbr, term},
-- so this function must filter on both.
--
-- This redefinition:
--   * Adds the term parameter and AND cw.term filter (SectionRef-scoped).
--   * Renames both params to the p_ convention (p_class_nbr, p_term).
--   * Adds the missing `engagement_disabled_at IS NULL` filter so the watcher
--     set matches get_watchers_for_sections (what the pipeline actually emails,
--     so the DLQ count is truthful).
--   * Adds ORDER BY cw.created_at for a stable admin "Date Added" ordering.
--
-- A signature change creates a distinct function object, so the earlier
-- REVOKE-from-PUBLIC/authenticated + GRANT-to-service_role lockdown (issue #159)
-- does NOT carry over. It is re-issued below for the new 2-arg signature to
-- avoid re-exposing watcher emails via PostgREST.

DROP FUNCTION IF EXISTS public.get_class_watchers(TEXT);

CREATE FUNCTION public.get_class_watchers(p_class_nbr TEXT, p_term TEXT)
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
    cw.id as watch_id,
    cw.created_at
  FROM public.class_watches cw
  INNER JOIN auth.users u ON u.id = cw.user_id
  LEFT JOIN public.user_profiles up ON up.user_id = cw.user_id
  WHERE cw.class_nbr = p_class_nbr
    AND cw.term = p_term
    AND COALESCE(up.notifications_enabled, true) = true
    AND COALESCE(up.email_bounced, false) = false
    AND COALESCE(up.spam_complained, false) = false
    AND COALESCE(up.is_disabled, false) = false
    AND up.engagement_disabled_at IS NULL
  ORDER BY cw.created_at;
$$;

COMMENT ON FUNCTION public.get_class_watchers(TEXT, TEXT) IS 'Returns users watching a specific Class Section (class_nbr + term) with their watch creation timestamp, filtered by notification preferences, email validity, active accounts, and engagement status.';

-- Re-lock the new signature (grants do not carry over from the dropped 1-arg fn).
REVOKE EXECUTE ON FUNCTION public.get_class_watchers(TEXT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_class_watchers(TEXT, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_class_watchers(TEXT, TEXT) TO service_role;
