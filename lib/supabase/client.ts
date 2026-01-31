import { createBrowserClient } from '@supabase/ssr';
import type { Database } from './database.types';

// Hardcoded public values - these are NOT secrets
// The anon key is designed to be public (rate-limited, RLS-protected)
const SUPABASE_URL = 'https://osopxwuebsefhoxgeojh.supabase.co';
const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9zb3B4d3VlYnNlZmhveGdlb2poIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjExMDQ4NzEsImV4cCI6MjA3NjY4MDg3MX0.23x_oMXkh6ELZ78aR1SqroM_X3Hbud8KlTS3RX32tpU';

export function createClient() {
  return createBrowserClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY);
}
