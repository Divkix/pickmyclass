-- The RETURNS TABLE columns are PL/pgSQL variables, so the unqualified column references in the
-- UPDATE raised 42702 ("column reference onboarding_completed_at is ambiguous") on every call.
CREATE OR REPLACE FUNCTION public.skip_onboarding(p_user_id text)
 RETURNS TABLE(onboarding_completed_at timestamp with time zone, onboarding_skipped_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.user_profiles up
    SET onboarding_skipped_at = NOW()
    WHERE up.user_id = p_user_id
      AND up.onboarding_completed_at IS NULL
      AND up.onboarding_skipped_at IS NULL;

  RETURN QUERY
    SELECT up.onboarding_completed_at, up.onboarding_skipped_at
    FROM public.user_profiles up
    WHERE up.user_id = p_user_id;
END;
$function$;
