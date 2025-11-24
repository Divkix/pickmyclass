import type { User } from '@supabase/supabase-js';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

/**
 * Admin authentication verification layer.
 *
 * Verifies that the current user has admin privileges by checking:
 * 1. User is authenticated (has valid session)
 * 2. User has is_admin flag set to true in user_profiles table
 *
 * @throws {never} Redirects to /login if not authenticated
 * @throws {never} Redirects to /dashboard if authenticated but not admin
 * @returns {Promise<User>} The authenticated admin user object
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
export async function verifyAdmin(): Promise<User> {
  const supabase = await createClient();

  // Check if user is authenticated
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    // Not authenticated - redirect to login
    redirect('/login');
  }

  // Check if user has admin privileges in user_profiles table
  const { data: profile, error: profileError } = await supabase
    .from('user_profiles')
    .select('is_admin')
    .eq('user_id', user.id)
    .single();

  if (profileError) {
    // Profile doesn't exist or database error - treat as non-admin
    console.error('Error fetching user profile:', profileError);
    redirect('/dashboard');
  }

  if (!profile?.is_admin) {
    // User is authenticated but not an admin
    redirect('/dashboard');
  }

  // User is authenticated and verified as admin
  return user;
}
