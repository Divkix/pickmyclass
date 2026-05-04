-- Fix notification expiration - replace UNIQUE constraint with partial unique index
-- Issue #157: The UNIQUE constraint on (class_watch_id, notification_type) was blocking
-- re-insertion even after notification expiration because the expired row still occupied
-- the unique slot. This migration replaces the constraint with a partial unique index
-- that only applies to active (non-expired) notifications.

-- Drop the existing UNIQUE constraint that blocks re-insertion after expiration
ALTER TABLE public.notifications_sent
DROP CONSTRAINT IF EXISTS unique_notification;

-- Create a partial unique index that only applies to non-expired notifications
-- This allows expired notifications to be overwritten/re-inserted
CREATE UNIQUE INDEX IF NOT EXISTS unique_notification_active
ON public.notifications_sent (class_watch_id, notification_type)
WHERE expires_at > NOW();

-- Add comment for documentation
COMMENT ON INDEX unique_notification_active IS
  'Partial unique index ensuring only one active notification per watch/type. Expired notifications (expires_at <= NOW()) can be re-inserted.';

-- Also update the batch notification function to remove the unique_violation exception handler
-- since it's no longer needed with the partial index. The function logic remains the same
-- but will now work correctly with the partial index.
CREATE OR REPLACE FUNCTION public.try_record_notifications_batch(
  p_class_watch_ids UUID[],
  p_notification_type TEXT,
  p_expires_hours INTEGER DEFAULT 24
)
RETURNS UUID[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_recorded_ids UUID[] := '{}';
  v_watch_id UUID;
BEGIN
  IF p_notification_type NOT IN ('seat_available', 'instructor_assigned') THEN
    RAISE EXCEPTION 'Invalid notification_type: %', p_notification_type;
  END IF;

  IF p_expires_hours < 1 OR p_expires_hours > 168 THEN
    RAISE EXCEPTION 'Invalid p_expires_hours: %', p_expires_hours;
  END IF;

  FOREACH v_watch_id IN ARRAY p_class_watch_ids
  LOOP
    BEGIN
      -- Check if an active notification already exists
      PERFORM 1 FROM public.notifications_sent
      WHERE class_watch_id = v_watch_id
        AND notification_type = p_notification_type
        AND expires_at > NOW()
      LIMIT 1;

      -- Only insert if no active notification found
      IF NOT FOUND THEN
        INSERT INTO public.notifications_sent (
          class_watch_id, notification_type, sent_at, expires_at
        ) VALUES (
          v_watch_id, p_notification_type, NOW(),
          NOW() + (p_expires_hours || ' hours')::INTERVAL
        );
        v_recorded_ids := array_append(v_recorded_ids, v_watch_id);
      END IF;

    EXCEPTION
      WHEN unique_violation THEN
        -- This should now only happen for race conditions with the partial index
        -- when two transactions try to insert the same active notification simultaneously
        NULL;
    END;
  END LOOP;

  RETURN v_recorded_ids;
END;
$$;

-- Grant execute permission to service role
GRANT EXECUTE ON FUNCTION public.try_record_notifications_batch(UUID[], TEXT, INTEGER) TO service_role;
