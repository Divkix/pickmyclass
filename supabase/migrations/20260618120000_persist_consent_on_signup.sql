-- Persist age/terms consent at user-profile creation time.
--
-- Previously the registration flow called the accept_terms_and_verify_age()
-- RPC from the client immediately after signUp(). With email confirmation
-- enabled there is no session at that point, so auth.uid() was NULL, the
-- UPDATE matched no rows, and age_verified_at / agreed_to_terms_at stayed NULL.
--
-- Fix: the client now passes the consent flags through signUp() user metadata
-- (raw_user_meta_data), and handle_new_user() persists the timestamps when the
-- profile row is created. This is atomic and race-free.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.user_profiles (user_id, created_at, age_verified_at, agreed_to_terms_at)
  VALUES (
    NEW.id,
    NOW(),
    CASE WHEN NEW.raw_user_meta_data->>'age_verified' = 'true' THEN NOW() END,
    CASE WHEN NEW.raw_user_meta_data->>'agreed_to_terms' = 'true' THEN NOW() END
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION public.handle_new_user() IS 'Creates a user_profiles row on signup, persisting age/terms consent from signup metadata (raw_user_meta_data) when present.';
