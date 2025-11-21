-- Table to track used unsubscribe tokens to prevent replay attacks
CREATE TABLE used_unsubscribe_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash text NOT NULL UNIQUE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  used_at timestamptz NOT NULL DEFAULT now()
);

-- Index for fast lookups
CREATE INDEX idx_used_unsubscribe_tokens_hash ON used_unsubscribe_tokens(token_hash);

-- Auto-cleanup old tokens (older than 90 days) - they're expired anyway
CREATE INDEX idx_used_unsubscribe_tokens_used_at ON used_unsubscribe_tokens(used_at);

-- RLS: Only service role can access this table
ALTER TABLE used_unsubscribe_tokens ENABLE ROW LEVEL SECURITY;

-- No policies = only service_role can access
