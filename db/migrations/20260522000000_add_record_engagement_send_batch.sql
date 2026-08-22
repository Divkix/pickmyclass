CREATE OR REPLACE FUNCTION public.record_engagement_send_batch(p_user_ids UUID[])
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
BEGIN
  FOREACH v_user_id IN ARRAY p_user_ids
  LOOP
    PERFORM public.record_engagement_send(v_user_id);
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_engagement_send_batch(UUID[]) TO service_role;
