import { invalidateAuthorizationState } from '@/lib/auth/authorization-state';
import { log } from '@/lib/log';
import { fail, ok } from '@/lib/api/response';
import { withAuth } from '@/lib/api/withAuth';
import { captureServerEvent } from '@/lib/posthog-server';
import { execute } from '@/lib/db/client';
import { createClient } from '@/lib/supabase/server';

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
    return await withAuth(supabase, async (user) => {
      try {
        const deletionTimestamp = new Date().toISOString();

        // Soft delete: update user_profiles directly (no RLS in PlanetScale — app-layer authz)
        try {
          await execute(
            `UPDATE user_profiles
             SET is_disabled = true,
                 disabled_at = $1,
                 notifications_enabled = false,
                 unsubscribed_at = $1
             WHERE user_id = $2`,
            [deletionTimestamp, user.id]
          );
        } catch (updateError) {
          log('User').error('Error disabling account:', updateError);
          return fail('Failed to delete account', 500);
        }

        // Invalidate the cached authorization state to ensure immediate effect
        invalidateAuthorizationState(user.id);

        await captureServerEvent({ distinctId: user.id, event: 'account_deleted' });

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
    });
  } catch (error) {
    log('User').error('Delete account error:', error);
    return fail('Failed to delete account', 500);
  }
}
