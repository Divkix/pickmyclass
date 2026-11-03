-- The admin dashboard now counts sections from get_sections_to_check, so no application path calls this RPC.
DROP FUNCTION public.count_distinct_classes_watched();
