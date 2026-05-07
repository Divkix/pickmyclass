-- Email Engagement Tracking System
-- Auto-disable notifications for disengaged users (7 emails, 0 opens in 30 days)
-- Allows re-engagement when user opens any email

-- Add engagement tracking columns to user_profiles
ALTER TABLE public.user_profiles
ADD COLUMN IF NOT EXISTS engagement_emails_sent INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS engagement_emails_opened INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS engagement_window_start TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS engagement_last_opened_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS engagement_disabled_at TIMESTAMP WITH TIME ZONE;

-- Index for efficient filtering in get_watchers_for_sections
CREATE INDEX IF NOT EXISTS idx_user_profiles_engagement
  ON public.user_profiles(user_id)
  WHERE engagement_disabled_at IS NULL;

-- Add comments for documentation
COMMENT ON COLUMN public.user_profiles.engagement_emails_sent IS 'Rolling count of emails sent in current 30-day window';
COMMENT ON COLUMN public.user_profiles.engagement_emails_opened IS 'Rolling count of emails opened in current 30-day window';
COMMENT ON COLUMN public.user_profiles.engagement_window_start IS 'Start of current 30-day tracking window';
COMMENT ON COLUMN public.user_profiles.engagement_last_opened_at IS 'Timestamp of last email open (from email provider webhook)';
COMMENT ON COLUMN public.user_profiles.engagement_disabled_at IS 'Timestamp when auto-disabled due to low engagement';

-- Function: Record email send and check engagement threshold
-- Returns TRUE if user should be disabled after this send
-- Atomic operation prevents race conditions with parallel queue workers
CREATE OR REPLACE FUNCTION public.record_engagement_send(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_window_start TIMESTAMP WITH TIME ZONE;
  v_emails_sent INTEGER;
  v_emails_opened INTEGER;
  v_window_age_days INTEGER;
  v_should_disable BOOLEAN := FALSE;
BEGIN
  -- Get current engagement state
  SELECT
    engagement_window_start,
    engagement_emails_sent,
    engagement_emails_opened
  INTO v_window_start, v_emails_sent, v_emails_opened
  FROM public.user_profiles
  WHERE user_id = p_user_id
  FOR UPDATE; -- Lock row for atomic update

  -- If no profile exists, create one
  IF NOT FOUND THEN
    INSERT INTO public.user_profiles (user_id, engagement_window_start, engagement_emails_sent)
    VALUES (p_user_id, NOW(), 1)
    ON CONFLICT (user_id) DO UPDATE
    SET engagement_emails_sent = COALESCE(user_profiles.engagement_emails_sent, 0) + 1,
        engagement_window_start = COALESCE(user_profiles.engagement_window_start, NOW());
    RETURN FALSE;
  END IF;

  -- Calculate window age
  IF v_window_start IS NULL THEN
    -- First email, start new window
    UPDATE public.user_profiles
    SET engagement_window_start = NOW(),
        engagement_emails_sent = 1,
        engagement_emails_opened = 0
    WHERE user_id = p_user_id;
    RETURN FALSE;
  END IF;

  v_window_age_days := EXTRACT(DAY FROM NOW() - v_window_start);

  -- Reset window if older than 30 days
  IF v_window_age_days >= 30 THEN
    UPDATE public.user_profiles
    SET engagement_window_start = NOW(),
        engagement_emails_sent = 1,
        engagement_emails_opened = 0
    WHERE user_id = p_user_id;
    RETURN FALSE;
  END IF;

  -- Increment sent counter
  v_emails_sent := COALESCE(v_emails_sent, 0) + 1;

  -- Check threshold: 7 emails sent, 0 opens = disable
  IF v_emails_sent >= 7 AND COALESCE(v_emails_opened, 0) = 0 THEN
    v_should_disable := TRUE;
    UPDATE public.user_profiles
    SET engagement_emails_sent = v_emails_sent,
        engagement_disabled_at = NOW(),
        notifications_enabled = FALSE
    WHERE user_id = p_user_id;
  ELSE
    UPDATE public.user_profiles
    SET engagement_emails_sent = v_emails_sent
    WHERE user_id = p_user_id;
  END IF;

  RETURN v_should_disable;
END;
$$;

COMMENT ON FUNCTION public.record_engagement_send(UUID) IS 'Record email send, increment counter, disable if 7+ sends with 0 opens in 30-day window';

-- Function: Record email open event (from email provider webhook)
-- Re-enables notifications if user was disabled due to low engagement
CREATE OR REPLACE FUNCTION public.record_engagement_open(p_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.user_profiles
  SET engagement_emails_opened = COALESCE(engagement_emails_opened, 0) + 1,
      engagement_last_opened_at = NOW(),
      -- Re-enable if was disabled due to engagement (not bounce/spam)
      notifications_enabled = CASE
        WHEN engagement_disabled_at IS NOT NULL
             AND email_bounced = FALSE
             AND spam_complained = FALSE
        THEN TRUE
        ELSE notifications_enabled
      END,
      -- Clear engagement disabled flag on re-engagement
      engagement_disabled_at = CASE
        WHEN engagement_disabled_at IS NOT NULL
             AND email_bounced = FALSE
             AND spam_complained = FALSE
        THEN NULL
        ELSE engagement_disabled_at
      END
  WHERE user_id = p_user_id;

  -- If no profile exists, create one with open recorded
  IF NOT FOUND THEN
    INSERT INTO public.user_profiles (user_id, engagement_emails_opened, engagement_last_opened_at)
    VALUES (p_user_id, 1, NOW())
    ON CONFLICT (user_id) DO UPDATE
    SET engagement_emails_opened = COALESCE(user_profiles.engagement_emails_opened, 0) + 1,
        engagement_last_opened_at = NOW();
  END IF;
END;
$$;

COMMENT ON FUNCTION public.record_engagement_open(UUID) IS 'Record email open, increment counter, re-enable notifications if user was engagement-disabled';

-- Update get_watchers_for_sections to filter out engagement-disabled users
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
    AND up.engagement_disabled_at IS NULL
  ORDER BY cw.class_nbr, cw.user_id;
$$;

COMMENT ON FUNCTION public.get_watchers_for_sections(TEXT[]) IS 'Bulk fetch watchers for multiple sections with email preferences filtering (eliminates N+1 queries), skips disabled accounts and engagement-disabled users';

-- Also update the single-section variant for consistency
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
    AND COALESCE(up.is_disabled, false) = false
    AND up.engagement_disabled_at IS NULL;
$$;

COMMENT ON FUNCTION public.get_class_watchers(TEXT) IS 'Returns users watching a class section who have notifications enabled, valid emails, active accounts, and not engagement-disabled (CAN-SPAM compliant)';

-- Function to get engagement stats for admin dashboard
CREATE OR REPLACE FUNCTION public.get_user_engagement_stats()
RETURNS TABLE (
  user_id UUID,
  engagement_emails_sent INTEGER,
  engagement_emails_opened INTEGER,
  engagement_rate NUMERIC,
  engagement_status TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    up.user_id,
    COALESCE(up.engagement_emails_sent, 0) as engagement_emails_sent,
    COALESCE(up.engagement_emails_opened, 0) as engagement_emails_opened,
    CASE
      WHEN COALESCE(up.engagement_emails_sent, 0) = 0 THEN NULL
      ELSE ROUND(
        (COALESCE(up.engagement_emails_opened, 0)::NUMERIC / up.engagement_emails_sent) * 100,
        1
      )
    END as engagement_rate,
    CASE
      WHEN up.engagement_disabled_at IS NOT NULL THEN 'disabled'
      WHEN COALESCE(up.engagement_emails_sent, 0) < 5 THEN 'new'
      WHEN COALESCE(up.engagement_emails_opened, 0) = 0 THEN 'low'
      ELSE 'healthy'
    END as engagement_status
  FROM public.user_profiles up;
$$;

COMMENT ON FUNCTION public.get_user_engagement_stats() IS 'Returns engagement statistics for all users for admin dashboard';
