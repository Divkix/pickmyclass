-- Add expiration column to notifications_sent table
-- This enables the hybrid notification reset system:
-- 1. Notifications expire after 24 hours (Safety Net #2)
-- 2. Notifications are reset when seats fill to zero (Safety Net #1)

-- Add expires_at column with default 24 hours from creation
ALTER TABLE public.notifications_sent
ADD COLUMN expires_at TIMESTAMP WITH TIME ZONE
DEFAULT (NOW() + INTERVAL '24 hours') NOT NULL;

-- Backfill existing records with sent_at + 24 hours
UPDATE public.notifications_sent
SET expires_at = sent_at + INTERVAL '24 hours'
WHERE expires_at IS NULL;

-- Add index for efficient expiration queries
CREATE INDEX IF NOT EXISTS idx_notifications_sent_expires_at
ON public.notifications_sent(expires_at);

-- Add comment for documentation
COMMENT ON COLUMN public.notifications_sent.expires_at IS
  'Notification expires after 24 hours to allow re-notification if seats remain available. Part of hybrid reset system.';
