-- Reuse the authenticated consent RPC for the OAuth consent gate. Preserve an
-- existing timestamp, stamp either missing value, and lock execution to signed-in
-- users. The callback and /api/auth/consent both run with an authenticated session.

CREATE OR REPLACE FUNCTION public.accept_terms_and_verify_age()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  consent_time TIMESTAMP WITH TIME ZONE := NOW();
BEGIN
  UPDATE public.user_profiles
  SET age_verified_at = COALESCE(age_verified_at, consent_time),
      agreed_to_terms_at = COALESCE(agreed_to_terms_at, consent_time)
  WHERE user_id = auth.uid();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'User profile not found';
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.accept_terms_and_verify_age() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.accept_terms_and_verify_age() FROM anon;
REVOKE EXECUTE ON FUNCTION public.accept_terms_and_verify_age() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.accept_terms_and_verify_age() TO authenticated;

COMMENT ON FUNCTION public.accept_terms_and_verify_age() IS
  'Atomically records missing age-verification and terms-consent timestamps for the authenticated user.';
