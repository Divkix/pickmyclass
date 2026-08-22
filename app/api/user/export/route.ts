import { NextResponse } from 'next/server';
import { log } from '@/lib/log';
import { fail } from '@/lib/api/response';
import { withAuth } from '@/lib/api/withAuth';
import { query, queryOne } from '@/lib/db/client';
import type {
  ClassStateRow,
  ClassWatchRow,
  NotificationSentRow,
  UserMirrorRow,
  UserProfileRow,
} from '@/lib/db/types';

/**
 * Data Export API - CCPA Compliance
 *
 * Allows users to download all their personal data in JSON format
 * California residents have the right to know what data is collected (CCPA)
 */
export async function GET(request: Request) {
  try {
    return await withAuth(request, async (user) => {
      try {
        // Mirror is the source of truth for email + verification post-Clerk cutover.
        const mirror = await queryOne<UserMirrorRow>('SELECT * FROM users WHERE id = $1', [
          user.userId,
        ]);
        const [profileRows, watches, notifications] = await Promise.all([
          query<UserProfileRow>('SELECT * FROM user_profiles WHERE user_id = $1', [user.userId]),
          query<
            ClassWatchRow & {
              class_state: Pick<
                ClassStateRow,
                | 'title'
                | 'instructor_name'
                | 'seats_available'
                | 'seats_capacity'
                | 'location'
                | 'meeting_times'
                | 'last_checked_at'
              > | null;
            }
          >(
            `SELECT w.*,
                    (SELECT row_to_json(cs.*)::jsonb
                     FROM class_states cs
                     WHERE cs.class_nbr = w.class_nbr AND cs.term = w.term
                     LIMIT 1) AS class_state
             FROM class_watches w
             WHERE w.user_id = $1
             ORDER BY w.created_at DESC`,
            [user.userId]
          ),
          query<
            NotificationSentRow & {
              class_watch: Pick<
                ClassWatchRow,
                'term' | 'subject' | 'catalog_nbr' | 'class_nbr'
              > | null;
            }
          >(
            `SELECT n.*,
                    (SELECT row_to_json(cw.*)::jsonb
                     FROM class_watches cw
                     WHERE cw.id = n.class_watch_id
                     LIMIT 1) AS class_watch
             FROM notifications_sent n
             INNER JOIN class_watches cw ON cw.id = n.class_watch_id
             WHERE cw.user_id = $1
             ORDER BY n.sent_at DESC`,
            [user.userId]
          ),
        ]);

        const profile = profileRows[0] ?? null;
        const exportData = {
          export_info: {
            exported_at: new Date().toISOString(),
            export_format: 'JSON',
            service: 'PickMyClass',
          },
          user_account: {
            email: mirror?.email ?? null,
            created_at: mirror?.created_at ?? null,
            last_sign_in_at: mirror?.last_sign_in_at ?? null,
            email_confirmed_at: mirror?.email_confirmed_at ?? null,
          },
          profile: {
            age_verified_at: profile?.age_verified_at,
            agreed_to_terms_at: profile?.agreed_to_terms_at,
            account_status: profile?.is_disabled ? 'disabled' : 'active',
            disabled_at: profile?.disabled_at,
          },
          class_watches: watches || [],
          notification_history: notifications || [],
          summary: {
            total_watches: watches?.length || 0,
            total_notifications: notifications?.length || 0,
            active_watches: profile?.is_disabled ? 0 : watches?.length || 0,
          },
        };

        const timestamp = new Date().toISOString().split('T')[0];
        const filename = `pickmyclass-data-${timestamp}.json`;

        return new NextResponse(JSON.stringify(exportData, null, 2), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'Content-Disposition': `attachment; filename="${filename}"`,
            'Cache-Control': 'no-store',
          },
        });
      } catch (error) {
        log('User').error('Export error:', error);
        return fail('Failed to export data', 500);
      }
    });
  } catch (error) {
    log('User').error('Export error:', error);
    return fail('Failed to export data', 500);
  }
}
