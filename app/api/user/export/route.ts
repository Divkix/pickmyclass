import { NextResponse } from 'next/server';
import { desc, eq, getTableColumns, sql } from 'drizzle-orm';
import { log } from '@/lib/log';
import { fail } from '@/lib/api/response';
import { withAuth } from '@/lib/api/withAuth';
import { getDbFromEnv } from '@/lib/db';
import {
  classWatches,
  notificationsSent,
  userProfiles,
  users,
  type ClassState,
  type ClassWatch,
} from '@/lib/db/schema';

/**
 * class_state projection embedded in each exported watch: the row_to_json
 * subset the export SQL has always projected from class_states.
 */
type ExportClassState = Pick<
  ClassState,
  | 'title'
  | 'instructor_name'
  | 'seats_available'
  | 'seats_capacity'
  | 'location'
  | 'meeting_times'
  | 'last_checked_at'
>;

/** class_watch stub embedded in each exported notification. */
type ExportWatchStub = Pick<ClassWatch, 'term' | 'subject' | 'catalog_nbr' | 'class_nbr'>;

/**
 * Normalize a nullable driver timestamp to the ISO-8601 UTC string shape this
 * endpoint has always emitted (postgres.js hands back PG text like
 * "2026-05-01 00:00:00+00" for timestamptz columns).
 */
function toIsoTimestamp(value: string | null): string | null {
  return value === null ? null : new Date(value).toISOString();
}

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
        // One request-scoped Drizzle handle for this invocation.
        const db = getDbFromEnv();

        // Mirror is the source of truth for email + verification post-Clerk cutover.
        const mirrorRows = await db.select().from(users).where(eq(users.id, user.userId)).limit(1);
        const [profileRows, watches, notifications] = await Promise.all([
          db.select().from(userProfiles).where(eq(userProfiles.user_id, user.userId)),
          db
            .select({
              ...getTableColumns(classWatches),
              // Correlated row_to_json fragments preserve the original nested
              // JSON shapes; PostgreSQL renders their timestamps server-side.
              class_state: sql<ExportClassState | null>`(
                SELECT row_to_json(cs.*)::jsonb
                FROM class_states cs
                WHERE cs.class_nbr = ${classWatches.class_nbr} AND cs.term = ${classWatches.term}
                LIMIT 1
              )`,
            })
            .from(classWatches)
            .where(eq(classWatches.user_id, user.userId))
            .orderBy(desc(classWatches.created_at)),
          db
            .select({
              ...getTableColumns(notificationsSent),
              class_watch: sql<ExportWatchStub | null>`(
                SELECT row_to_json(cw2.*)::jsonb
                FROM class_watches cw2
                WHERE cw2.id = ${notificationsSent.class_watch_id}
                LIMIT 1
              )`,
            })
            .from(notificationsSent)
            .innerJoin(classWatches, eq(classWatches.id, notificationsSent.class_watch_id))
            .where(eq(classWatches.user_id, user.userId))
            .orderBy(desc(notificationsSent.sent_at)),
        ]);

        const mirror = mirrorRows[0] ?? null;
        const profile = profileRows[0] ?? null;
        const exportData = {
          export_info: {
            exported_at: new Date().toISOString(),
            export_format: 'JSON',
            service: 'PickMyClass',
          },
          user_account: {
            email: mirror?.email ?? null,
            created_at: mirror ? toIsoTimestamp(mirror.created_at) : null,
            last_sign_in_at: mirror ? toIsoTimestamp(mirror.last_sign_in_at) : null,
            email_confirmed_at: mirror ? toIsoTimestamp(mirror.email_confirmed_at) : null,
          },
          profile: {
            age_verified_at: profile ? toIsoTimestamp(profile.age_verified_at) : undefined,
            agreed_to_terms_at: profile ? toIsoTimestamp(profile.agreed_to_terms_at) : undefined,
            account_status: profile?.is_disabled ? 'disabled' : 'active',
            disabled_at: profile ? toIsoTimestamp(profile.disabled_at) : undefined,
          },
          class_watches: watches.map((watch) => ({
            ...watch,
            created_at: toIsoTimestamp(watch.created_at),
          })),
          notification_history: notifications.map((notification) => ({
            ...notification,
            sent_at: toIsoTimestamp(notification.sent_at),
            expires_at: toIsoTimestamp(notification.expires_at),
          })),
          summary: {
            total_watches: watches.length || 0,
            total_notifications: notifications.length || 0,
            active_watches: profile?.is_disabled ? 0 : watches.length || 0,
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
