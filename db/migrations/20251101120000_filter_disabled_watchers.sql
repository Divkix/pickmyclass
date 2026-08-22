-- Ensure disabled accounts never receive notifications

DROP FUNCTION IF EXISTS public.get_class_watchers(TEXT);

CREATE FUNCTION public.get_class_watchers(section_number TEXT)
RETURNS TABLE (
  user_id UUID,
  email TEXT,
  watch_id UUID
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    cw.user_id,
    u.email::TEXT,
    cw.id as watch_id
  FROM public.class_watches cw
  INNER JOIN auth.users u ON u.id = cw.user_id
  LEFT JOIN public.user_profiles up ON up.user_id = cw.user_id
  WHERE cw.class_nbr = section_number
    AND COALESCE(up.notifications_enabled, true) = true
    AND COALESCE(up.email_bounced, false) = false
    AND COALESCE(up.spam_complained, false) = false
    AND COALESCE(up.is_disabled, false) = false;
$$;

COMMENT ON FUNCTION public.get_class_watchers(TEXT) IS 'Returns users watching a class section who have notifications enabled, valid emails, and active accounts (CAN-SPAM compliant)';

DROP FUNCTION IF EXISTS public.get_watchers_for_sections(TEXT[]);

CREATE FUNCTION public.get_watchers_for_sections(section_numbers TEXT[])
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
    AND COALESCE(up.notifications_enabled, true) = true
    AND COALESCE(up.email_bounced, false) = false
    AND COALESCE(up.spam_complained, false) = false
    AND COALESCE(up.is_disabled, false) = false
  ORDER BY cw.class_nbr, cw.user_id;
$$;

COMMENT ON FUNCTION public.get_watchers_for_sections(TEXT[]) IS 'Bulk fetch watchers for multiple sections with email preferences filtering (eliminates N+1 queries) and skips disabled accounts';
