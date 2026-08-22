-- Update get_class_watchers function to filter by email preferences
-- Only return users who have notifications enabled and valid emails
CREATE OR REPLACE FUNCTION public.get_class_watchers(section_number TEXT)
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
    -- Only include users with notifications enabled (default true if profile doesn't exist)
    AND COALESCE(up.notifications_enabled, true) = true
    -- Exclude bounced emails
    AND COALESCE(up.email_bounced, false) = false
    -- Exclude spam complaints
    AND COALESCE(up.spam_complained, false) = false;
$$;

-- Update comment
COMMENT ON FUNCTION public.get_class_watchers(TEXT) IS 'Returns users watching a class section who have notifications enabled and valid emails (CAN-SPAM compliant)';
