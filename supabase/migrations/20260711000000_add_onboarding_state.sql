-- Onboarding state: first-time skip flow + finish-setup card.
--
-- Adds onboarding_completed_at and onboarding_skipped_at to user_profiles.
-- New users (created via handle_new_user) get NULL for both and see a blocking
-- onboarding modal on the dashboard. Dismissing it (Escape / backdrop / Skip)
-- sets onboarding_skipped_at, which reveals a compact "Finish setup" card that
-- persists until the user creates their first class watch (which sets
-- onboarding_completed_at).
--
-- Existing users (created before this feature) are backfilled with
-- onboarding_completed_at = NOW() so they never see the modal or card.

-- Step 1: Add the onboarding columns.
ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS onboarding_completed_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS onboarding_skipped_at TIMESTAMP WITH TIME ZONE;

-- Step 2: Backfill existing profiles so pre-feature users are treated as onboarded.
UPDATE public.user_profiles
  SET onboarding_completed_at = NOW()
  WHERE onboarding_completed_at IS NULL;

-- Step 3: Lock the new columns down in the escalation-prevention trigger so
-- non-service roles cannot self-complete or self-skip by writing them directly.
CREATE OR REPLACE FUNCTION public.prevent_user_profile_escalation()
RETURNS TRIGGER AS $$
BEGIN
  -- Service role and supabase_admin can modify everything
  IF current_user IN ('service_role', 'supabase_admin', 'postgres') THEN
    RETURN NEW;
  END IF;

  -- For all other roles, force restricted columns to their old values
  NEW.is_admin := OLD.is_admin;
  NEW.is_disabled := OLD.is_disabled;
  NEW.disabled_at := OLD.disabled_at;
  NEW.email_bounced := OLD.email_bounced;
  NEW.email_bounced_at := OLD.email_bounced_at;
  NEW.spam_complained := OLD.spam_complained;
  NEW.spam_complained_at := OLD.spam_complained_at;
  NEW.engagement_emails_sent := OLD.engagement_emails_sent;
  NEW.engagement_emails_opened := OLD.engagement_emails_opened;
  NEW.engagement_window_start := OLD.engagement_window_start;
  NEW.engagement_last_opened_at := OLD.engagement_last_opened_at;
  NEW.engagement_disabled_at := OLD.engagement_disabled_at;
  NEW.age_verified_at := OLD.age_verified_at;
  NEW.agreed_to_terms_at := OLD.agreed_to_terms_at;
  NEW.onboarding_completed_at := OLD.onboarding_completed_at;
  NEW.onboarding_skipped_at := OLD.onboarding_skipped_at;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Step 4: skip_onboarding() RPC — the only user-writable path to set
-- onboarding_skipped_at. SECURITY DEFINER so it bypasses the escalation trigger.
-- Refuses to overwrite a completed or already-skipped profile.
CREATE OR REPLACE FUNCTION public.skip_onboarding()
RETURNS TABLE (
  onboarding_completed_at TIMESTAMP WITH TIME ZONE,
  onboarding_skipped_at TIMESTAMP WITH TIME ZONE
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.user_profiles
    SET onboarding_skipped_at = NOW()
    WHERE user_id = auth.uid()
      AND onboarding_completed_at IS NULL
      AND onboarding_skipped_at IS NULL;

  RETURN QUERY
    SELECT up.onboarding_completed_at, up.onboarding_skipped_at
    FROM public.user_profiles up
    WHERE up.user_id = auth.uid();
END;
$$;

REVOKE EXECUTE ON FUNCTION public.skip_onboarding() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.skip_onboarding() FROM anon;
GRANT EXECUTE ON FUNCTION public.skip_onboarding() TO authenticated;

COMMENT ON COLUMN public.user_profiles.onboarding_completed_at IS 'When the user finished onboarding (e.g. created their first class watch). NULL means onboarding is still pending.';
COMMENT ON COLUMN public.user_profiles.onboarding_skipped_at IS 'When the user dismissed the first-time onboarding modal. NULL means they have not skipped.';
COMMENT ON FUNCTION public.skip_onboarding() IS 'Marks onboarding as skipped for the current user. No-ops if already completed or skipped. Returns the resulting onboarding state.';
