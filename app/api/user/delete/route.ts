import { requireUser, UnauthorizedError } from '@/lib/auth/require-user';
import { log } from '@/lib/log';
import { fail, ok } from '@/lib/api/response';
import { createClient } from '@/lib/supabase/server';
import { getServiceClient } from '@/lib/supabase/service';
import { invalidateProfileCache } from '@/proxy';

/**
 * Account Deletion API - CCPA Compliance
 *
 * Soft-deletes user account (sets disabled flag)
 * Data is retained for 30 days for business records, then purged
 * California residents have the right to deletion (CCPA)
 *
 * US-compliant: Soft delete is acceptable in US, unlike GDPR
 */
export async function DELETE() {
  try {
    const supabase = await createClient();

    let user: Awaited<ReturnType<typeof requireUser>>['user'];
    try {
      ({ user } = await requireUser(supabase));
    } catch (e) {
      if (e instanceof UnauthorizedError) return fail('Unauthorized', 401);
      throw e;
    }

    const deletionTimestamp = new Date().toISOString();

    // Soft delete: Use service client since is_disabled/disabled_at are restricted columns
    const serviceClient = getServiceClient();
    const { error: updateError } = await serviceClient
      .from('user_profiles')
      .update({
        is_disabled: true,
        disabled_at: deletionTimestamp,
        notifications_enabled: false,
        unsubscribed_at: deletionTimestamp,
      })
      .eq('user_id', user.id);

    if (updateError) {
      log('User').error('Error disabling account:', updateError);
      return fail('Failed to delete account', 500);
    }

    // Invalidate the profile cache to ensure immediate effect
    invalidateProfileCache(user.id);

    // Sign out the user (invalidate session)
    const { error: signOutError } = await supabase.auth.signOut();

    if (signOutError) {
      log('User').error('Error signing out:', signOutError);
      // Don't fail the request if sign out fails
    }

    return ok({
      message:
        'Account disabled successfully. Your data will be permanently deleted after 30 days.',
      disabled_at: deletionTimestamp,
      permanent_deletion_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    });
  } catch (error) {
    log('User').error('Delete account error:', error);
    return fail('Failed to delete account', 500);
  }
}
