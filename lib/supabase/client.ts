import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from './config';
import type { Database } from './database.types';

export function createClient(): SupabaseClient<Database> {
  return createBrowserClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY);
}
