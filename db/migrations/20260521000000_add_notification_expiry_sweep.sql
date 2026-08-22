-- Add a scheduled expiry sweep for the notification dedup table.
--
-- Background: the partial unique index `unique_notification_active` (see
-- 20260503194401_fix_notification_expiration_unique_constraint.sql) only treats rows with
-- is_active = TRUE as occupying a dedup slot. However, nothing ever flips is_active back to
-- FALSE after a record's expires_at passes (only a one-time backfill did). As a result an
-- expired dedup slot is never freed, so a genuinely-expired record can never be re-claimed.
--
-- This function flips expired active records to inactive. Run it on the daily cron so expired
-- dedup slots are freed and re-claimable on the next cycle, without any destructive deletes.

CREATE OR REPLACE FUNCTION public.expire_stale_notifications()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  UPDATE public.notifications_sent
  SET is_active = FALSE
  WHERE is_active = TRUE AND expires_at IS NOT NULL AND expires_at <= NOW();
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.expire_stale_notifications() TO service_role;
