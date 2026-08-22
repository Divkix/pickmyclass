import { requireUser, UnauthorizedError } from '@/lib/auth/require-user';
import type { SessionIdentity } from '@/lib/auth/clerk-session';
import { fail } from '@/lib/api/response';

/**
 * Centralized auth wrapper for API routes.
 * Eliminates duplicated try{ requireUser } catch(UnauthorizedError) blocks.
 */
export async function withAuth(
  request: Request,
  handler: (user: SessionIdentity) => Promise<Response>
): Promise<Response> {
  try {
    const { user } = await requireUser(request);
    return await handler(user);
  } catch (e) {
    if (e instanceof UnauthorizedError) return fail('Unauthorized', 401);
    throw e;
  }
}
