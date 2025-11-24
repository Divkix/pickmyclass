import { createBrowserClient } from '@supabase/ssr';
import { Database } from './database.types';

export function createClient() {
  // Use placeholder values during build if env vars are not available
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co';
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-key';

  return createBrowserClient<Database>(url, key);
}
