import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { readAuthorizationState } from '@/lib/auth/authorization-state';
import { getSessionIdentityFromHeaders } from '@/lib/auth/clerk-session';
import { queryOne } from '@/lib/db/client';
import type { UserMirrorRow } from '@/lib/db/types';

export interface AdminUser {
  id: string;
  email: string;
  clerkUserId: string;
  sessionId: string | null;
}

/**
 * Admin authentication verification layer (Clerk edition).
 *
 * Verifies that the current user has admin privileges by checking:
 * 1. User is authenticated (valid Clerk session via workerd header)
 * 2. User has is_admin flag set to true in user_profiles table
 * 3. User's account is not disabled
 *
 * @throws {never} Redirects to /login if not authenticated
 * @throws {never} Redirects to /login if the account is disabled
 * @throws {never} Redirects to /dashboard if authenticated but not admin
 * @returns {Promise<AdminUser>} The authenticated admin user (compat shape: id + email)
 *
 * @example
 * ```typescript
 * // In a server component or API route
 * export default async function AdminPage() {
 *   const adminUser = await verifyAdmin()
 *   // User is guaranteed to be authenticated and admin at this point
 *   return <AdminDashboard user={adminUser} />
 * }
 * ```
 */
export async function verifyAdmin(): Promise<AdminUser> {
  const headerStore = await headers();
  const identity = await getSessionIdentityFromHeaders(headerStore);

  if (!identity) {
    redirect('/login');
  }

  // Check admin privileges via a FRESH authorization read (never cached), so a
  // demoted or disabled admin is enforced immediately on admin pages.
  const authState = await readAuthorizationState(identity.userId, { cache: false });

  if (authState?.is_disabled) {
    redirect('/login');
  }

  if (!authState?.is_admin) {
    redirect('/dashboard');
  }

  // Resolve email from the users mirror for display purposes. The mirror is the
  // Clerk-webhook-synced source of truth post-cutover; the Supabase auth email
  // no longer exists.
  const row = await queryOne<Pick<UserMirrorRow, 'email'>>(
    'SELECT email FROM users WHERE id = $1',
    [identity.userId]
  );

  return {
    id: identity.userId,
    email: row?.email ?? '',
    clerkUserId: identity.clerkUserId,
    sessionId: identity.sessionId,
  };
}
