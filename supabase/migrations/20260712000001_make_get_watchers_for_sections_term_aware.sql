-- Make get_watchers_for_sections term-aware (another SectionRef site).
--
-- get_watchers_for_sections filtered by class_nbr alone (via `cw.class_nbr =
-- ANY(section_numbers)`). Because a section number repeats across terms, a
-- transition in one term selected watchers for the same class number in a
-- DIFFERENT term, sending wrong-term notification emails. This is the same
-- defect class already fixed for get_class_watchers in 20260701040540 — the
-- notification path was missed.
--
-- A Class Section's identity is the SectionRef {class_nbr, term}, so recipient
-- selection must filter on both. The sole caller (sendSectionNotifications)
-- already processes one SectionRef at a time, so the bulk-array shape is kept
-- and scoped to a single term via the new p_term parameter.
--
-- This redefinition:
--   * Adds the p_term parameter and AND cw.term = p_term filter (SectionRef-scoped).
--   * Preserves the existing watcher-eligibility filters (notifications_enabled,
--     NOT email_bounced, NOT spam_complained, NOT is_disabled,
--     engagement_disabled_at IS NULL) — unchanged and still in sync with
--     get_sections_to_check / get_class_watchers / get_most_watched_class.
--
-- A signature change creates a distinct function object, so the earlier
-- REVOKE-from-PUBLIC/authenticated + GRANT-to-service_role lockdown (issue #159)
-- does NOT carry over. It is re-issued below for the new 2-arg signature to
-- avoid re-exposing watcher emails via PostgREST.

DROP FUNCTION IF EXISTS public.get_watchers_for_sections(TEXT[]);

CREATE FUNCTION public.get_watchers_for_sections(section_numbers TEXT[], p_term TEXT)
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
    cw.id as watch_id,
    cw.class_nbr
  FROM public.class_watches cw
  INNER JOIN auth.users u ON u.id = cw.user_id
  LEFT JOIN public.user_profiles up ON up.user_id = cw.user_id
  WHERE cw.class_nbr = ANY(section_numbers)
    AND cw.term = p_term
    AND COALESCE(up.notifications_enabled, true) = true
    AND COALESCE(up.email_bounced, false) = false
    AND COALESCE(up.spam_complained, false) = false
    AND COALESCE(up.is_disabled, false) = false
    AND up.engagement_disabled_at IS NULL
  ORDER BY cw.class_nbr, cw.user_id;
$$;

COMMENT ON FUNCTION public.get_watchers_for_sections(TEXT[], TEXT) IS 'Bulk fetch watchers for the supplied sections within a single term (SectionRef-scoped: class_nbr + term) with email-preferences filtering, skipping disabled and engagement-disabled accounts. Eliminates N+1 queries and prevents cross-term recipient selection.';

-- Re-lock the new signature (grants do not carry over from the dropped 1-arg fn).
REVOKE EXECUTE ON FUNCTION public.get_watchers_for_sections(TEXT[], TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_watchers_for_sections(TEXT[], TEXT) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.get_watchers_for_sections(TEXT[], TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_watchers_for_sections(TEXT[], TEXT) TO service_role;
