-- Fix: Prevent users from updating their own is_admin flag
-- Security issue: Users could escalate privileges by setting is_admin = true

DROP POLICY IF EXISTS "Users can update own profile" ON public.user_profiles;

CREATE POLICY "Users can update own profile except admin flag"
  ON public.user_profiles
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (
    auth.uid() = user_id AND
    -- Ensure is_admin cannot be changed by the user
    (is_admin IS NOT DISTINCT FROM (SELECT is_admin FROM public.user_profiles WHERE user_id = auth.uid()))
  );
