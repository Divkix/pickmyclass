import type { SupabaseClient, User } from '@supabase/supabase-js';
import { timingSafeCompare } from '@/lib/utils/crypto';

export class UnauthorizedError extends Error {
  readonly status = 401;
  constructor(message = 'Unauthorized') {
    super(message);
    this.name = 'UnauthorizedError';
  }
}

/**
 * Require an authenticated user.
 * Throws UnauthorizedError if the session is missing or invalid.
 */
export async function requireUser(supabase: SupabaseClient): Promise<{ user: User }> {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) throw new UnauthorizedError();
  return { user };
}

/** Verify cron secret Bearer token. Returns true if valid. */
export function verifyCronSecret(
  request: { headers: { get(name: string): string | null } },
  cronSecret: string | undefined
): boolean {
  if (!cronSecret) return false;
  const authHeader = request.headers.get('authorization');
  if (!authHeader) return false;
  return timingSafeCompare(authHeader, `Bearer ${cronSecret}`);
}
