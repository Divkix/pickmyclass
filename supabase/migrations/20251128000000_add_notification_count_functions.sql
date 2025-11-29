-- Add PostgreSQL functions for efficient notification count aggregation
-- Used by admin panel to display emails sent per class and per user

-- Get notification counts by type grouped by class number
CREATE OR REPLACE FUNCTION get_notification_counts_by_class()
RETURNS TABLE(class_nbr TEXT, seat_emails BIGINT, instructor_emails BIGINT) AS $$
BEGIN
  RETURN QUERY
  SELECT
    cw.class_nbr,
    COUNT(*) FILTER (WHERE ns.notification_type = 'seat_available')::BIGINT as seat_emails,
    COUNT(*) FILTER (WHERE ns.notification_type = 'instructor_assigned')::BIGINT as instructor_emails
  FROM notifications_sent ns
  JOIN class_watches cw ON ns.class_watch_id = cw.id
  GROUP BY cw.class_nbr;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION get_notification_counts_by_class IS
  'Returns count of seat_available and instructor_assigned notifications per class section. Used by admin panel.';

-- Get notification counts by type grouped by user ID
CREATE OR REPLACE FUNCTION get_notification_counts_by_user()
RETURNS TABLE(user_id UUID, seat_emails BIGINT, instructor_emails BIGINT) AS $$
BEGIN
  RETURN QUERY
  SELECT
    cw.user_id,
    COUNT(*) FILTER (WHERE ns.notification_type = 'seat_available')::BIGINT as seat_emails,
    COUNT(*) FILTER (WHERE ns.notification_type = 'instructor_assigned')::BIGINT as instructor_emails
  FROM notifications_sent ns
  JOIN class_watches cw ON ns.class_watch_id = cw.id
  GROUP BY cw.user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION get_notification_counts_by_user IS
  'Returns count of seat_available and instructor_assigned notifications per user. Used by admin panel.';

-- Covering indexes for JOIN performance (if not already exist)
CREATE INDEX IF NOT EXISTS idx_class_watches_id_class_nbr ON public.class_watches(id, class_nbr);
CREATE INDEX IF NOT EXISTS idx_class_watches_id_user_id ON public.class_watches(id, user_id);
