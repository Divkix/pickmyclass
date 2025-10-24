-- Create function to get all users watching a specific class section
-- This function handles the JOIN between public.class_watches and auth.users
-- SECURITY DEFINER allows the function to access auth.users even when called by service role
CREATE OR REPLACE FUNCTION public.get_class_watchers(section_number TEXT)
RETURNS TABLE (
  user_id UUID,
  email TEXT,
  watch_id UUID
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    cw.user_id,
    u.email::TEXT,
    cw.id as watch_id
  FROM public.class_watches cw
  INNER JOIN auth.users u ON u.id = cw.user_id
  WHERE cw.class_nbr = section_number;
$$;

-- Add comment for documentation
COMMENT ON FUNCTION public.get_class_watchers(TEXT) IS 'Returns all users watching a specific class section with their email addresses';
