-- Query Optimization Functions for Scalability
-- Purpose: Server-side filtering and bulk operations to reduce database round trips

-- Function 1: Get sections to check based on stagger type (even/odd)
-- This eliminates fetching all rows to the application layer
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
  WHERE
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

COMMENT ON FUNCTION public.get_sections_to_check(TEXT) IS 'Returns distinct class sections to check filtered by even/odd last digit for staggered cron processing';


-- Function 2: Bulk fetch watchers for multiple sections
-- Eliminates N+1 query problem when processing multiple sections
CREATE OR REPLACE FUNCTION public.get_watchers_for_sections(section_numbers TEXT[])
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
    -- Only include users with notifications enabled (default true if profile doesn't exist)
    AND COALESCE(up.notifications_enabled, true) = true
    -- Exclude bounced emails
    AND COALESCE(up.email_bounced, false) = false
    -- Exclude spam complaints
    AND COALESCE(up.spam_complained, false) = false
  ORDER BY cw.class_nbr, cw.user_id;
$$;

COMMENT ON FUNCTION public.get_watchers_for_sections(TEXT[]) IS 'Bulk fetch watchers for multiple sections with email preferences filtering (eliminates N+1 queries)';
