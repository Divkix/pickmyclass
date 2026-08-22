-- Fix notification expiration - replace UNIQUE constraint with partial unique index
-- Issue #157: The UNIQUE constraint on (class_watch_id, notification_type) was blocking
-- re-insertion even after notification expiration because the expired row still occupied
-- the unique slot. This migration replaces the constraint with a partial unique index
-- that only applies to active (non-expired) notifications.

-- Drop the existing UNIQUE constraint that blocks re-insertion after expiration
ALTER TABLE public.notifications_sent
DROP CONSTRAINT IF EXISTS unique_notification;

-- Add an is_active column for the partial index
-- Using a boolean column is required because PostgreSQL partial unique indexes
-- cannot use volatile functions like NOW() in their predicates
ALTER TABLE public.notifications_sent
ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;

-- Update existing rows: set is_active = FALSE for expired notifications
UPDATE public.notifications_sent
SET is_active = FALSE
WHERE expires_at IS NOT NULL AND expires_at <= NOW();

-- Create a partial unique index that only applies to active notifications
-- This allows expired notifications to be overwritten/re-inserted
CREATE UNIQUE INDEX IF NOT EXISTS unique_notification_active
ON public.notifications_sent (class_watch_id, notification_type)
WHERE is_active = TRUE;

-- Add comment for documentation
COMMENT ON INDEX unique_notification_active IS
  'Partial unique index ensuring only one active notification per watch/type. Expired notifications (is_active = FALSE) can be re-inserted.';

-- Update the batch notification function to use is_active instead of expires_at > NOW()
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
        AND is_active = TRUE
      LIMIT 1;

      -- Only insert if no active notification found
      IF NOT FOUND THEN
        INSERT INTO public.notifications_sent (
          class_watch_id, notification_type, sent_at, expires_at, is_active
        ) VALUES (
          v_watch_id, p_notification_type, NOW(),
          NOW() + (p_expires_hours || ' hours')::INTERVAL,
          TRUE
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

-- Also update the single notification function for consistency
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
  v_existing_id UUID;
BEGIN
  -- Validate notification type
  IF p_notification_type NOT IN ('seat_available', 'instructor_assigned') THEN
    RAISE EXCEPTION 'Invalid notification_type: %. Must be seat_available or instructor_assigned', p_notification_type;
  END IF;

  -- Validate expiration hours
  IF p_expires_hours < 1 OR p_expires_hours > 168 THEN
    RAISE EXCEPTION 'Invalid p_expires_hours: %. Must be between 1 and 168', p_expires_hours;
  END IF;

  -- Check if active notification already exists
  SELECT id INTO v_existing_id
  FROM public.notifications_sent
  WHERE class_watch_id = p_class_watch_id
    AND notification_type = p_notification_type
    AND is_active = TRUE
  LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    RETURN FALSE;
  END IF;

  -- Attempt to insert new notification
  BEGIN
    INSERT INTO public.notifications_sent (
      class_watch_id,
      notification_type,
      sent_at,
      expires_at,
      is_active
    )
    VALUES (
      p_class_watch_id,
      p_notification_type,
      NOW(),
      NOW() + (p_expires_hours || ' hours')::INTERVAL,
      TRUE
    );

    RETURN TRUE;

  EXCEPTION
    WHEN unique_violation THEN
      RETURN FALSE;
  END;
END;
$$;

-- Grant execute permission to service role
GRANT EXECUTE ON FUNCTION public.try_record_notifications_batch(UUID[], TEXT, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.try_record_notification(UUID, TEXT, INTEGER) TO service_role;
