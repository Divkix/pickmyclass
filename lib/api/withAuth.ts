import type { SupabaseClient, User } from '@supabase/supabase-js';
import { requireUser, UnauthorizedError } from '@/lib/auth/require-user';
import { fail } from '@/lib/api/response';

/**
 * Centralized auth wrapper for API routes.
 * Eliminates duplicated try{ requireUser } catch(UnauthorizedError) blocks.
 */
export async function withAuth(
  supabase: SupabaseClient,
  handler: (user: User) => Promise<Response>
): Promise<Response> {
  try {
    const { user } = await requireUser(supabase);
    return await handler(user);
  } catch (e) {
    if (e instanceof UnauthorizedError) return fail('Unauthorized', 401);
    throw e;
  }
}
