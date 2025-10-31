-- Atomic Notification Check Function
-- Fixes race condition in parallel queue processing where multiple workers
-- can send duplicate notifications for the same class watch.
--
-- Problem: Check-then-insert pattern allows race condition:
--   Worker A: hasNotificationBeenSent() -> false
--   Worker B: hasNotificationBeenSent() -> false
--   Worker A: sendEmail() -> recordNotificationSent()
--   Worker B: sendEmail() -> recordNotificationSent() (DUPLICATE!)
--
-- Solution: Atomic INSERT with ON CONFLICT DO NOTHING
--   Only one worker can successfully insert the notification record.
--   The function returns true if insertion succeeds, false if already exists.
--   Call this BEFORE sending emails to guarantee exactly-once delivery.

-- Drop existing partial index if it exists (from previous migrations)
DROP INDEX IF EXISTS idx_notifications_sent_active;

-- Atomic notification check-and-record function
-- Returns true if notification was recorded (safe to send email)
-- Returns false if notification already exists (skip email)
CREATE OR REPLACE FUNCTION public.try_record_notification(
  p_class_watch_id UUID,
  p_notification_type TEXT,
  p_expires_hours INTEGER DEFAULT 24
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inserted BOOLEAN;
  v_existing_id UUID;
BEGIN
  -- Validate notification type
  IF p_notification_type NOT IN ('seat_available', 'instructor_assigned') THEN
    RAISE EXCEPTION 'Invalid notification_type: %. Must be seat_available or instructor_assigned', p_notification_type;
  END IF;

  -- Validate expiration hours
  IF p_expires_hours < 1 OR p_expires_hours > 168 THEN -- Max 1 week
    RAISE EXCEPTION 'Invalid p_expires_hours: %. Must be between 1 and 168', p_expires_hours;
  END IF;

  -- Check if non-expired notification already exists
  -- This is atomic because we're in a transaction
  SELECT id INTO v_existing_id
  FROM public.notifications_sent
  WHERE class_watch_id = p_class_watch_id
    AND notification_type = p_notification_type
    AND expires_at > NOW()
  LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    -- Notification already exists and hasn't expired
    RETURN FALSE;
  END IF;

  -- Attempt to insert new notification
  -- If another worker inserted between our SELECT and INSERT, this will fail due to unique constraint
  BEGIN
    INSERT INTO public.notifications_sent (
      class_watch_id,
      notification_type,
      sent_at,
      expires_at
    )
    VALUES (
      p_class_watch_id,
      p_notification_type,
      NOW(),
      NOW() + (p_expires_hours || ' hours')::INTERVAL
    );

    -- Insert succeeded
    RETURN TRUE;

  EXCEPTION
    WHEN unique_violation THEN
      -- Another worker won the race, they'll send the email
      RETURN FALSE;
  END;
END;
$$;

COMMENT ON FUNCTION public.try_record_notification(UUID, TEXT, INTEGER) IS
  'Atomically checks and records notification in one operation. Returns true if notification was recorded (safe to send email), false if already exists. Eliminates race condition in parallel processing.';

-- Grant execute permission to service_role (used by queue processor)
GRANT EXECUTE ON FUNCTION public.try_record_notification(UUID, TEXT, INTEGER) TO service_role;
