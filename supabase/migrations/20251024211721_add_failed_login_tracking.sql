-- Create table for tracking failed login attempts
CREATE TABLE IF NOT EXISTS failed_login_attempts (
  email TEXT PRIMARY KEY,
  attempts INTEGER DEFAULT 0,
  locked_until TIMESTAMPTZ,
  last_attempt_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add index on locked_until for faster lockout checks
CREATE INDEX IF NOT EXISTS idx_failed_login_locked_until ON failed_login_attempts(locked_until) WHERE locked_until IS NOT NULL;

-- Enable RLS
ALTER TABLE failed_login_attempts ENABLE ROW LEVEL SECURITY;

-- No RLS policies needed - this table is managed by application logic only
-- Users should not be able to query or modify their own lockout status
