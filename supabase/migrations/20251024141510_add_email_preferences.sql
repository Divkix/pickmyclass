-- Add email preferences to user_profiles table for CAN-SPAM compliance
-- Tracks user notification preferences, unsubscribe status, and email validity

-- Add email preference columns to user_profiles
ALTER TABLE public.user_profiles
ADD COLUMN IF NOT EXISTS notifications_enabled BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN IF NOT EXISTS unsubscribed_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS email_bounced BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS email_bounced_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS spam_complained BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS spam_complained_at TIMESTAMP WITH TIME ZONE;

-- Create index for notification checks in cron jobs
CREATE INDEX IF NOT EXISTS idx_user_profiles_notifications_enabled
  ON public.user_profiles(user_id)
  WHERE notifications_enabled = true AND email_bounced = false AND spam_complained = false;

-- Add comments for documentation
COMMENT ON COLUMN public.user_profiles.notifications_enabled IS 'Whether user wants to receive email notifications (CAN-SPAM compliance)';
COMMENT ON COLUMN public.user_profiles.unsubscribed_at IS 'Timestamp when user unsubscribed from all emails';
COMMENT ON COLUMN public.user_profiles.email_bounced IS 'Email address is invalid (hard bounce from Resend)';
COMMENT ON COLUMN public.user_profiles.email_bounced_at IS 'Timestamp when email bounce was detected';
COMMENT ON COLUMN public.user_profiles.spam_complained IS 'User marked email as spam (auto-unsubscribe)';
COMMENT ON COLUMN public.user_profiles.spam_complained_at IS 'Timestamp when spam complaint was received';
