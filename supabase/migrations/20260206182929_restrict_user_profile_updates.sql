-- Fix: Restrict user_profiles UPDATE to only user-modifiable columns
-- The original UPDATE policy allowed users to modify ANY column including is_admin

-- Step 1: Revoke broad UPDATE from authenticated role
REVOKE UPDATE ON public.user_profiles FROM authenticated;

-- Step 2: Grant UPDATE only on user-modifiable columns
GRANT UPDATE(notifications_enabled, unsubscribed_at) ON public.user_profiles TO authenticated;

-- Step 3: Defense-in-depth trigger (prevents escalation even if GRANTs are misconfigured)
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

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_prevent_profile_escalation
  BEFORE UPDATE ON public.user_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_user_profile_escalation();

-- Step 4: RPC function for registration flow (age/terms verification)
CREATE OR REPLACE FUNCTION public.accept_terms_and_verify_age()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.user_profiles
  SET age_verified_at = NOW(),
      agreed_to_terms_at = NOW()
  WHERE user_id = auth.uid();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'User profile not found';
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.accept_terms_and_verify_age() TO authenticated;
