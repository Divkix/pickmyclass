-- Enable Row Level Security on all tables
ALTER TABLE public.class_watches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.class_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications_sent ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- RLS Policies for class_watches
-- ============================================================================

-- Policy: Users can view only their own class watches
CREATE POLICY "Users can view their own class watches"
  ON public.class_watches
  FOR SELECT
  USING (auth.uid() = user_id);

-- Policy: Users can insert their own class watches
CREATE POLICY "Users can create their own class watches"
  ON public.class_watches
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Policy: Users can update their own class watches (if needed in future)
CREATE POLICY "Users can update their own class watches"
  ON public.class_watches
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Policy: Users can delete their own class watches
CREATE POLICY "Users can delete their own class watches"
  ON public.class_watches
  FOR DELETE
  USING (auth.uid() = user_id);

-- ============================================================================
-- RLS Policies for class_states
-- ============================================================================

-- Policy: Anyone (authenticated) can view class states
-- This is public data scraped from ASU, so authenticated users can read it
CREATE POLICY "Authenticated users can view class states"
  ON public.class_states
  FOR SELECT
  TO authenticated
  USING (true);

-- Policy: Only service_role can insert/update/delete class states
-- The cron job will use service_role key to update this table
-- No policy needed here - service_role bypasses RLS

-- ============================================================================
-- RLS Policies for notifications_sent
-- ============================================================================

-- Policy: Users can view notifications for their own watches
CREATE POLICY "Users can view notifications for their watches"
  ON public.notifications_sent
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.class_watches
      WHERE class_watches.id = notifications_sent.class_watch_id
        AND class_watches.user_id = auth.uid()
    )
  );

-- Policy: Only service_role can insert notifications
-- The cron job will use service_role key to insert notifications
-- No policy needed here - service_role bypasses RLS

-- ============================================================================
-- Helper function to check if user owns a class watch
-- ============================================================================

CREATE OR REPLACE FUNCTION public.user_owns_class_watch(watch_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1
    FROM public.class_watches
    WHERE id = watch_id
      AND user_id = auth.uid()
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Add comment explaining security model
COMMENT ON POLICY "Users can view their own class watches" ON public.class_watches IS
  'Users can only access their own class watch subscriptions';
COMMENT ON POLICY "Authenticated users can view class states" ON public.class_states IS
  'Class states are public data from ASU, readable by all authenticated users';
COMMENT ON FUNCTION public.user_owns_class_watch IS
  'Helper function to check if current user owns a specific class watch';
