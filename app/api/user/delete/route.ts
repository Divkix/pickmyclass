import { eq } from 'drizzle-orm';

import { invalidateAuthorizationState } from '@/lib/auth/authorization-state';
import { revokeAllUserSessions } from '@/lib/auth/clerk-session';
import { log } from '@/lib/log';
import { fail, ok } from '@/lib/api/response';
import { withAuth } from '@/lib/api/withAuth';
import { captureServerEvent } from '@/lib/analytics/server';
import { getDbFromEnv } from '@/lib/db';
import { userProfiles } from '@/lib/db/schema';

export async function DELETE(request: Request) {
  try {
    return await withAuth(request, async (user) => {
      try {
        const deletionTimestamp = new Date().toISOString();

        try {
          const db = getDbFromEnv();
          await db
            .update(userProfiles)
            .set({
              is_disabled: true,
              disabled_at: deletionTimestamp,
              notifications_enabled: false,
              unsubscribed_at: deletionTimestamp,
            })
            .where(eq(userProfiles.user_id, user.userId));
        } catch (updateError) {
          log('User').error('Error disabling account:', updateError);
          return fail('Failed to delete account', 500);
        }

        invalidateAuthorizationState(user.userId);

        captureServerEvent(user.userId, 'account_deleted', {});

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
