-- Fix: Add validation to get_sections_to_check to prevent returning all rows on invalid input
-- Security issue: Invalid stagger_type would return ALL sections instead of failing

CREATE OR REPLACE FUNCTION public.get_sections_to_check(stagger_type TEXT)
RETURNS TABLE (
  class_nbr TEXT,
  term TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Validate input to prevent unexpected behavior
  IF stagger_type NOT IN ('even', 'odd', 'all') THEN
    RAISE EXCEPTION 'Invalid stagger_type: %. Must be even, odd, or all', stagger_type;
  END IF;

  RETURN QUERY
  SELECT DISTINCT
    cw.class_nbr,
    cw.term
  FROM public.class_watches cw
  WHERE
    CASE
      WHEN stagger_type = 'even' THEN
        (CAST(SUBSTRING(cw.class_nbr FROM LENGTH(cw.class_nbr) FOR 1) AS INTEGER) % 2) = 0
      WHEN stagger_type = 'odd' THEN
        (CAST(SUBSTRING(cw.class_nbr FROM LENGTH(cw.class_nbr) FOR 1) AS INTEGER) % 2) = 1
      ELSE
        TRUE  -- 'all' returns everything
    END
  ORDER BY cw.class_nbr;
END;
$$;

COMMENT ON FUNCTION public.get_sections_to_check(TEXT) IS 'Returns distinct class sections to check filtered by even/odd/all. Validates input to prevent accidental full table returns.';
