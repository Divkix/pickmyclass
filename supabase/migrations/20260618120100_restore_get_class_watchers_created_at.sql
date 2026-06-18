-- Restore created_at on get_class_watchers.
--
-- Migration 20251031164421 added created_at to the function's return signature
-- (used by the admin class-detail "Date Added" column). Migration
-- 20251101120000 later redefined the function to filter disabled accounts but
-- dropped the created_at column, so the admin page now renders "-".
--
-- This redefinition keeps the disabled-account filter AND re-adds created_at.

DROP FUNCTION IF EXISTS public.get_class_watchers(TEXT);

CREATE FUNCTION public.get_class_watchers(section_number TEXT)
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
  WHERE cw.class_nbr = section_number
    AND COALESCE(up.notifications_enabled, true) = true
    AND COALESCE(up.email_bounced, false) = false
    AND COALESCE(up.spam_complained, false) = false
    AND COALESCE(up.is_disabled, false) = false;
$$;

COMMENT ON FUNCTION public.get_class_watchers(TEXT) IS 'Returns users watching a class section with their watch creation timestamp (filtered by notification preferences, email validity, and active accounts).';
