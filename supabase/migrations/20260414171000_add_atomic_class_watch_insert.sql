-- Atomically create class watches with per-user watch limit enforcement.
-- Prevents concurrent requests from bypassing MAX_WATCHES_PER_USER checks.

CREATE OR REPLACE FUNCTION public.create_class_watch_with_limit(
  p_user_id UUID,
  p_term TEXT,
  p_subject TEXT,
  p_catalog_nbr TEXT,
  p_class_nbr TEXT,
  p_max_watches INTEGER
)
RETURNS public.class_watches
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_current_count INTEGER;
  v_watch public.class_watches;
BEGIN
  IF p_max_watches < 1 THEN
    RAISE EXCEPTION 'Invalid watch limit: %', p_max_watches;
  END IF;

  -- Serialize watch creation per user to avoid race conditions.
  PERFORM pg_advisory_xact_lock(('x' || SUBSTRING(md5(p_user_id::TEXT), 1, 16))::BIT(64)::BIGINT);

  SELECT COUNT(*)
  INTO v_current_count
  FROM public.class_watches
  WHERE user_id = p_user_id;

  IF v_current_count >= p_max_watches THEN
    RAISE EXCEPTION 'MAX_WATCHES_EXCEEDED'
      USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.class_watches (
    user_id,
    term,
    subject,
    catalog_nbr,
    class_nbr
  )
  VALUES (
    p_user_id,
    p_term,
    p_subject,
    p_catalog_nbr,
    p_class_nbr
  )
  RETURNING * INTO v_watch;

  RETURN v_watch;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_class_watch_with_limit(UUID, TEXT, TEXT, TEXT, TEXT, INTEGER) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_class_watch_with_limit(UUID, TEXT, TEXT, TEXT, TEXT, INTEGER) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.create_class_watch_with_limit(UUID, TEXT, TEXT, TEXT, TEXT, INTEGER) TO service_role;

COMMENT ON FUNCTION public.create_class_watch_with_limit(UUID, TEXT, TEXT, TEXT, TEXT, INTEGER) IS
  'Atomically inserts a class watch with per-user max watch enforcement to prevent concurrent limit bypass.';
