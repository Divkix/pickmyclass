import type { NextResponse } from 'next/server';
import { getSessionIdentity, type SessionIdentity } from '@/lib/auth/clerk-session';
import { fail } from '@/lib/api/response';
import { timingSafeCompare } from '@/lib/utils/crypto';

export class UnauthorizedError extends Error {
  constructor(message = 'Unauthorized') {
    super(message);
    this.name = 'UnauthorizedError';
  }
}

/**
 * Require an authenticated user for an API route.
 * Verifies the Clerk session on the incoming request (networkless) and
 * returns the session identity. Throws UnauthorizedError if the session is
 * missing or invalid.
 */
export async function requireUser(request: Request): Promise<{ user: SessionIdentity }> {
  const user = await getSessionIdentity(request);
  if (!user) throw new UnauthorizedError();
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

/**
 * Cron auth gate shared by the cron + maintenance routes: CRON_SECRET-missing
 * 500 + Bearer `verifyCronSecret` 401. Returns the failure response, or null
 * when the request is authorized. Callers log with their own scope on non-null.
 */
export function requireCronAuth(
  request: { headers: { get(name: string): string | null } },
  cronSecret: string | undefined
): NextResponse | null {
  if (!cronSecret) {
    return fail('Server configuration error', 500);
  }
  if (!verifyCronSecret(request, cronSecret)) {
    return fail('Unauthorized', 401);
  }
  return null;
}
