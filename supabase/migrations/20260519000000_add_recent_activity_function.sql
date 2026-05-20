-- Add covering indexes for recent activity queries
CREATE INDEX IF NOT EXISTS idx_notifications_sent_sent_at
  ON public.notifications_sent(sent_at DESC, class_watch_id, notification_type);

CREATE INDEX IF NOT EXISTS idx_class_watches_created_at
  ON public.class_watches(created_at DESC, user_id, class_nbr, subject, catalog_nbr);

-- Unified recent activity feed
-- Unions auth.users (registrations), class_watches (new watches), and notifications_sent (emails)
CREATE OR REPLACE FUNCTION public.get_recent_activity(p_limit INTEGER DEFAULT 50)
RETURNS TABLE (
  activity_type TEXT,
  activity_at TIMESTAMP WITH TIME ZONE,
  user_email TEXT,
  class_nbr TEXT,
  subject TEXT,
  catalog_nbr TEXT,
  notification_type TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  (
    SELECT
      'user_registration'::TEXT as activity_type,
      u.created_at as activity_at,
      u.email::TEXT as user_email,
      NULL::TEXT as class_nbr,
      NULL::TEXT as subject,
      NULL::TEXT as catalog_nbr,
      NULL::TEXT as notification_type
    FROM auth.users u
    ORDER BY u.created_at DESC
  )
  UNION ALL
  (
    SELECT
      'new_watch'::TEXT as activity_type,
      cw.created_at as activity_at,
      auth_u.email::TEXT as user_email,
      cw.class_nbr,
      cw.subject,
      cw.catalog_nbr,
      NULL::TEXT as notification_type
    FROM public.class_watches cw
    INNER JOIN auth.users auth_u ON auth_u.id = cw.user_id
    ORDER BY cw.created_at DESC
  )
  UNION ALL
  (
    SELECT
      'email_sent'::TEXT as activity_type,
      ns.sent_at as activity_at,
      auth_u.email::TEXT as user_email,
      cw.class_nbr,
      cw.subject,
      cw.catalog_nbr,
      ns.notification_type::TEXT
    FROM public.notifications_sent ns
    INNER JOIN public.class_watches cw ON cw.id = ns.class_watch_id
    INNER JOIN auth.users auth_u ON auth_u.id = cw.user_id
    ORDER BY ns.sent_at DESC
  )
  ORDER BY activity_at DESC
  LIMIT p_limit;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_recent_activity(INTEGER) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_recent_activity(INTEGER) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_recent_activity(INTEGER) TO service_role;

COMMENT ON FUNCTION public.get_recent_activity(INTEGER) IS
  'Returns a unified recent activity feed combining user registrations, new class watches, and sent email notifications. Used by the admin dashboard. SECURITY DEFINER is required to access auth.users.';
