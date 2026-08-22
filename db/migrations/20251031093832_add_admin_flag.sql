-- Add admin flag to user profiles
-- Allows marking specific users as administrators with full access to admin dashboard

ALTER TABLE user_profiles
ADD COLUMN is_admin BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN user_profiles.is_admin IS 'Indicates if user has admin privileges';

-- Create partial index for fast admin lookups (only indexes true values)
CREATE INDEX idx_user_profiles_is_admin ON user_profiles(is_admin) WHERE is_admin = true;
