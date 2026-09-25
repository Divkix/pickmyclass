import { getSessionIdentity, type SessionIdentity } from '@/lib/auth/clerk-session';
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
