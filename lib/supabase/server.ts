import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import type { Database } from './database.types';

// Hardcoded public values - these are NOT secrets
// The anon key is designed to be public (rate-limited, RLS-protected)
const SUPABASE_URL = 'https://osopxwuebsefhoxgeojh.supabase.co';
const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9zb3B4d3VlYnNlZmhveGdlb2poIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjExMTA4NzEsImV4cCI6MjA3NjY4MDg3MX0.23x_oMXkh6ELZ78aR1SqroM_X3Hbud8KlTS3RX32tpU';

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // The `setAll` method was called from a Server Component.
          // This can be ignored if you have middleware refreshing
          // user sessions.
        }
      },
    },
  });
}
