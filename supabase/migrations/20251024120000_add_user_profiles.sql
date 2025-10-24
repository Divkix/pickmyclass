-- Create user_profiles table for account management and compliance
-- Stores user preferences, account status, and legal compliance flags
CREATE TABLE IF NOT EXISTS public.user_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Account status
  is_disabled BOOLEAN NOT NULL DEFAULT false,
  disabled_at TIMESTAMP WITH TIME ZONE,

  -- Legal compliance
  age_verified_at TIMESTAMP WITH TIME ZONE,
  agreed_to_terms_at TIMESTAMP WITH TIME ZONE,

  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,

  -- Ensure one profile per user
  CONSTRAINT unique_user_profile UNIQUE (user_id)
);

-- Create index for lookups
CREATE INDEX IF NOT EXISTS idx_user_profiles_user_id ON public.user_profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_user_profiles_disabled ON public.user_profiles(is_disabled) WHERE is_disabled = true;

-- Enable Row Level Security
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;

-- RLS Policies
-- Users can read their own profile
CREATE POLICY "Users can view own profile"
  ON public.user_profiles
  FOR SELECT
  USING (auth.uid() = user_id);

-- Users can update their own profile (for preferences)
CREATE POLICY "Users can update own profile"
  ON public.user_profiles
  FOR UPDATE
  USING (auth.uid() = user_id);

-- Service role can do everything (for API endpoints)
CREATE POLICY "Service role has full access"
  ON public.user_profiles
  FOR ALL
  USING (auth.jwt()->>'role' = 'service_role');

-- Function to auto-create user profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.user_profiles (user_id, created_at)
  VALUES (NEW.id, NOW());
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to create profile when user signs up
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION public.update_user_profile_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-update updated_at
CREATE TRIGGER trigger_user_profiles_updated_at
  BEFORE UPDATE ON public.user_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.update_user_profile_updated_at();

-- Add comments
COMMENT ON TABLE public.user_profiles IS 'User account settings and compliance tracking';
COMMENT ON COLUMN public.user_profiles.is_disabled IS 'Soft delete flag for account deletion requests';
COMMENT ON COLUMN public.user_profiles.disabled_at IS 'Timestamp when account was disabled';
COMMENT ON COLUMN public.user_profiles.age_verified_at IS 'When user verified they are 18+ (COPPA compliance)';
COMMENT ON COLUMN public.user_profiles.agreed_to_terms_at IS 'When user agreed to Terms of Service';
