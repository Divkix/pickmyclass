-- Fix SECURITY DEFINER function permissions
-- Issue: 5 SECURITY DEFINER functions were executable by PUBLIC via PostgREST
-- because REVOKE was never issued, only GRANT (which is additive).
-- This prevents email addresses and other sensitive data from being exposed.
-- ref: https://github.com/Divkix/pickmyclass/issues/159

-- get_class_watchers: Returns user emails watching a class section
REVOKE EXECUTE ON FUNCTION public.get_class_watchers(TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_class_watchers(TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_class_watchers(TEXT) TO service_role;

-- get_watchers_for_sections: Bulk fetches watcher emails for multiple sections
REVOKE EXECUTE ON FUNCTION public.get_watchers_for_sections(TEXT[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_watchers_for_sections(TEXT[]) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_watchers_for_sections(TEXT[]) TO service_role;

-- get_sections_to_check: Returns distinct sections for staggered cron processing
REVOKE EXECUTE ON FUNCTION public.get_sections_to_check(TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_sections_to_check(TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_sections_to_check(TEXT) TO service_role;

-- try_record_notifications_batch: Atomically records notifications to prevent duplicates
REVOKE EXECUTE ON FUNCTION public.try_record_notifications_batch(UUID[], TEXT, INTEGER) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.try_record_notifications_batch(UUID[], TEXT, INTEGER) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.try_record_notifications_batch(UUID[], TEXT, INTEGER) TO service_role;

-- delete_notification_records: Deletes notification records for given watch IDs
REVOKE EXECUTE ON FUNCTION public.delete_notification_records(UUID[], TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.delete_notification_records(UUID[], TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.delete_notification_records(UUID[], TEXT) TO service_role;
