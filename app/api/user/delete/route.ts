import { invalidateAuthorizationState } from '@/lib/auth/authorization-state';
import { revokeAllUserSessions } from '@/lib/auth/clerk-session';
import { log } from '@/lib/log';
import { fail, ok } from '@/lib/api/response';
import { withAuth } from '@/lib/api/withAuth';
import { captureServerEvent } from '@/lib/posthog-server';
import { execute } from '@/lib/db/client';

/**
 * Account Deletion API - CCPA Compliance
 *
 * Soft-deletes user account (sets disabled flag)
 * Data is retained for 30 days for business records, then purged
 * California residents have the right to deletion (CCPA)
 *
 * US-compliant: Soft delete is acceptable in US, unlike GDPR
 */
export async function DELETE(request: Request) {
  try {
    return await withAuth(request, async (user) => {
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
            [deletionTimestamp, user.userId]
          );
        } catch (updateError) {
          log('User').error('Error disabling account:', updateError);
          return fail('Failed to delete account', 500);
        }

        // Invalidate the cached authorization state to ensure immediate effect
        invalidateAuthorizationState(user.userId);

        await captureServerEvent({ distinctId: user.userId, event: 'account_deleted' });

        // Revoke all Clerk sessions for the user (CCPA sign-out equivalent).
        try {
          await revokeAllUserSessions(user.clerkUserId);
        } catch (error) {
          log('User').error('Failed to revoke Clerk sessions on delete:', error);
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
