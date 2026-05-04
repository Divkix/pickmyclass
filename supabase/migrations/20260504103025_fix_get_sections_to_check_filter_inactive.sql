-- Fix: get_sections_to_check should only return sections with active watchers
-- Issue: Previously returned sections watched only by disabled/bounced/spam users
-- This wasted ASU API calls since get_watchers_for_sections would find no active watchers

-- Drop and recreate the function with user_profiles join to filter out inactive watchers
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
  -- Join with user_profiles to filter out sections with only inactive watchers
  LEFT JOIN public.user_profiles up ON up.user_id = cw.user_id
  WHERE
    -- Only include watches with active user profiles
    COALESCE(up.notifications_enabled, true) = true
    AND COALESCE(up.email_bounced, false) = false
    AND COALESCE(up.spam_complained, false) = false
    AND COALESCE(up.is_disabled, false) = false
    AND
    CASE
      WHEN stagger_type = 'even' THEN
        -- Last digit is even (0, 2, 4, 6, 8)
        (CAST(SUBSTRING(cw.class_nbr FROM LENGTH(cw.class_nbr) FOR 1) AS INTEGER) % 2) = 0
      WHEN stagger_type = 'odd' THEN
        -- Last digit is odd (1, 3, 5, 7, 9)
        (CAST(SUBSTRING(cw.class_nbr FROM LENGTH(cw.class_nbr) FOR 1) AS INTEGER) % 2) = 1
      ELSE
        -- Invalid stagger_type, return all
        TRUE
    END
  ORDER BY cw.class_nbr;
$$;

COMMENT ON FUNCTION public.get_sections_to_check(TEXT) IS 'Returns distinct class sections to check filtered by even/odd last digit and active watchers only. Excludes sections where all watchers are disabled, bounced, or spam-complained.';
