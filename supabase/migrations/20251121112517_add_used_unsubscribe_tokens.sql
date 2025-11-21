-- Table to track used unsubscribe tokens to prevent replay attacks
CREATE TABLE used_unsubscribe_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash text NOT NULL UNIQUE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  used_at timestamptz NOT NULL DEFAULT now()
);

-- Index for fast lookups
CREATE INDEX idx_used_unsubscribe_tokens_hash ON used_unsubscribe_tokens(token_hash);

-- Index for cleanup queries. Cleanup must be done externally via:
-- DELETE FROM used_unsubscribe_tokens WHERE used_at < NOW() - INTERVAL '90 days';
-- Run this via Cloudflare cron or external scheduler (Supabase doesn't support pg_cron)
CREATE INDEX idx_used_unsubscribe_tokens_used_at ON used_unsubscribe_tokens(used_at);

-- RLS: Only service role can access this table
ALTER TABLE used_unsubscribe_tokens ENABLE ROW LEVEL SECURITY;

-- No policies = only service_role can access
