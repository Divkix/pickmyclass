-- Add atomic function to increment failed login attempts
-- This fixes the race condition in SELECT-then-UPSERT pattern
-- by using INSERT ... ON CONFLICT DO UPDATE with atomic increment

CREATE OR REPLACE FUNCTION increment_failed_attempts(
  p_email TEXT,
  p_max_attempts INTEGER DEFAULT 5,
  p_lockout_minutes INTEGER DEFAULT 15
)
RETURNS TABLE (attempts INTEGER, locked BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_attempts INTEGER;
  v_locked_until TIMESTAMPTZ;
  v_now TIMESTAMPTZ := NOW();
BEGIN
  -- Atomic insert or increment
  INSERT INTO failed_login_attempts (email, attempts, last_attempt_at, locked_until)
  VALUES (p_email, 1, v_now, NULL)
  ON CONFLICT (email) DO UPDATE SET
    attempts = failed_login_attempts.attempts + 1,
    last_attempt_at = v_now,
    -- Lock if attempts reach max (minus 1 because we're about to increment)
    locked_until = CASE
      WHEN failed_login_attempts.attempts + 1 >= p_max_attempts
      THEN v_now + (p_lockout_minutes || ' minutes')::INTERVAL
      ELSE NULL
    END
  RETURNING failed_login_attempts.attempts, failed_login_attempts.locked_until INTO v_attempts, v_locked_until;

  RETURN QUERY SELECT v_attempts, (v_locked_until IS NOT NULL AND v_locked_until > v_now);
END;
$$;

-- Revoke default permissions and grant execute only to service_role
REVOKE EXECUTE ON FUNCTION public.increment_failed_attempts(TEXT, INTEGER, INTEGER) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.increment_failed_attempts(TEXT, INTEGER, INTEGER) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.increment_failed_attempts(TEXT, INTEGER, INTEGER) TO service_role;
