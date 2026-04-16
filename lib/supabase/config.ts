/**
 * Shared Supabase configuration constants.
 *
 * These are PUBLIC values (not secrets). The anon key is designed to be
 * public-facing - it's rate-limited and protected by Row Level Security (RLS).
 */

/**
 * Supabase project URL
 */
export const SUPABASE_URL = 'https://osopxwuebsefhoxgeojh.supabase.co';

/**
 * Supabase anonymous/public API key
 */
export const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9zb3B4d3VlYnNlZmhveGdlb2poIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjExMDQ4NzEsImV4cCI6MjA3NjY4MDg3MX0.23x_oMXkh6ELZ78aR1SqroM_X3Hbud8KlTS3RX32tpU';
