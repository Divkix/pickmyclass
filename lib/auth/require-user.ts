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

export async function requireUser(request: Request): Promise<{ user: SessionIdentity }> {
  const user = await getSessionIdentity(request);
  if (!user) throw new UnauthorizedError();
  return { user };
}

export function verifyCronSecret(
  request: { headers: { get(name: string): string | null } },
  cronSecret: string | undefined
): boolean {
  if (!cronSecret) return false;
  const authHeader = request.headers.get('authorization');
  if (!authHeader) return false;
  return timingSafeCompare(authHeader, `Bearer ${cronSecret}`);
}

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
