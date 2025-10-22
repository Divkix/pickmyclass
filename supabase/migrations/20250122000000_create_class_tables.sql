-- Create class_watches table
-- Stores which users are watching which class sections
CREATE TABLE IF NOT EXISTS public.class_watches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  term TEXT NOT NULL, -- e.g., "2261" (Spring 2026, Session 1)
  subject TEXT NOT NULL, -- e.g., "CSE"
  catalog_nbr TEXT NOT NULL, -- e.g., "240"
  class_nbr TEXT NOT NULL, -- e.g., "12431" (section number)
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,

  -- Prevent duplicate watches per user
  CONSTRAINT unique_user_class_watch UNIQUE (user_id, term, class_nbr)
);

-- Create class_states table
-- Caches current state of monitored classes to detect changes
CREATE TABLE IF NOT EXISTS public.class_states (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  term TEXT NOT NULL,
  subject TEXT NOT NULL,
  catalog_nbr TEXT NOT NULL,
  class_nbr TEXT NOT NULL UNIQUE, -- Section number is globally unique
  title TEXT, -- Course title, e.g., "Introduction to Programming"
  instructor_name TEXT, -- Current instructor or "Staff"
  seats_available INTEGER NOT NULL DEFAULT 0,
  seats_capacity INTEGER NOT NULL DEFAULT 0,
  location TEXT, -- e.g., "TEMPE" or "ONLINE"
  meeting_times TEXT, -- e.g., "MW 9:00 AM-10:15 AM"
  last_checked_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  last_changed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

-- Create notifications_sent table
-- Tracks which notifications have been sent to avoid duplicates
CREATE TABLE IF NOT EXISTS public.notifications_sent (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  class_watch_id UUID NOT NULL REFERENCES public.class_watches(id) ON DELETE CASCADE,
  notification_type TEXT NOT NULL CHECK (notification_type IN ('seat_available', 'instructor_assigned')),
  sent_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,

  -- Prevent duplicate notifications for same watch/type
  CONSTRAINT unique_notification UNIQUE (class_watch_id, notification_type)
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_class_watches_user_id ON public.class_watches(user_id);
CREATE INDEX IF NOT EXISTS idx_class_watches_class_nbr ON public.class_watches(class_nbr);
CREATE INDEX IF NOT EXISTS idx_class_states_class_nbr ON public.class_states(class_nbr);
CREATE INDEX IF NOT EXISTS idx_class_states_last_checked ON public.class_states(last_checked_at);
CREATE INDEX IF NOT EXISTS idx_notifications_sent_class_watch ON public.notifications_sent(class_watch_id);

-- Create function to automatically update last_changed_at when relevant fields change
CREATE OR REPLACE FUNCTION update_class_state_changed_at()
RETURNS TRIGGER AS $$
BEGIN
  -- Only update last_changed_at if seats or instructor actually changed
  IF (OLD.seats_available != NEW.seats_available) OR
     (OLD.instructor_name != NEW.instructor_name) OR
     (OLD.instructor_name IS NULL AND NEW.instructor_name IS NOT NULL) OR
     (OLD.instructor_name IS NOT NULL AND NEW.instructor_name IS NULL) THEN
    NEW.last_changed_at = NOW();
  END IF;

  -- Always update last_checked_at
  NEW.last_checked_at = NOW();

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to call the function on updates
CREATE TRIGGER trigger_update_class_state_changed_at
  BEFORE UPDATE ON public.class_states
  FOR EACH ROW
  EXECUTE FUNCTION update_class_state_changed_at();

-- Add comments for documentation
COMMENT ON TABLE public.class_watches IS 'Stores user subscriptions to class sections for notifications';
COMMENT ON TABLE public.class_states IS 'Caches current state of monitored classes from ASU API';
COMMENT ON TABLE public.notifications_sent IS 'Deduplication log for sent notifications';
COMMENT ON COLUMN public.class_watches.class_nbr IS 'ASU section number (5 digits)';
COMMENT ON COLUMN public.class_states.class_nbr IS 'ASU section number (5 digits, globally unique)';
