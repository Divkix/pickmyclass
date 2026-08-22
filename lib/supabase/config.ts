/**
 * Shared Supabase configuration constants — DEPRECATED.
 *
 * Supabase Auth is replaced by Clerk (issue #351). This module is kept only
 * for test compatibility and will be removed once all Supabase references are
 * gone. New code must use `lib/db/client.ts` (Hyperdrive pg) and
 * `lib/auth/clerk-session.ts` instead. The values are no longer hardcoded;
 * they are read from env for any remaining legacy callers.
 */
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';

export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
