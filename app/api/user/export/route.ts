import { desc, eq, getTableColumns, sql } from "drizzle-orm";
import { errorFields, log } from "@/lib/log";
import { fail } from "@/lib/api/response";
import { withAuth } from "@/lib/api/withAuth";
import { getDbFromEnv } from "@/lib/db";
import {
  classWatches,
  notificationsSent,
  userProfiles,
  users,
  type ClassState,
  type ClassWatch,
} from "@/lib/db/schema";

type ExportClassState = Pick<
  ClassState,
  | "title"
  | "instructor_name"
  | "seats_available"
  | "seats_capacity"
  | "location"
  | "meeting_times"
  | "last_checked_at"
>;

type ExportWatchStub = Pick<ClassWatch, "term" | "subject" | "catalog_nbr" | "class_nbr">;

function toIsoTimestamp(value: string | null): string | null {
  return value === null ? null : new Date(value).toISOString();
}

export async function GET(request: Request) {
  try {
    return await withAuth(request, async (user) => {
      try {
        const db = getDbFromEnv();

        const mirrorRows = await db.select().from(users).where(eq(users.id, user.userId)).limit(1);

        const [profileRows, watches, notifications] = await Promise.all([
          db.select().from(userProfiles).where(eq(userProfiles.user_id, user.userId)),
          db
            .select({
              ...getTableColumns(classWatches),
              class_state: sql<ExportClassState | null>`(
                SELECT jsonb_build_object(
                  'title', cs.title,
                  'instructor_name', cs.instructor_name,
                  'seats_available', cs.seats_available,
                  'seats_capacity', cs.seats_capacity,
                  'location', cs.location,
                  'meeting_times', cs.meeting_times,
                  'last_checked_at', cs.last_checked_at
                )
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
              id: notificationsSent.id,
              class_watch_id: notificationsSent.class_watch_id,
              notification_type: notificationsSent.notification_type,
              sent_at: notificationsSent.sent_at,
              expires_at: notificationsSent.expires_at,
              is_active: notificationsSent.is_active,
              class_watch: sql<ExportWatchStub | null>`(
                SELECT jsonb_build_object(
                  'term', cw2.term,
                  'subject', cw2.subject,
                  'catalog_nbr', cw2.catalog_nbr,
                  'class_nbr', cw2.class_nbr
                )
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
            export_format: "JSON",
            service: "PickMyClass",
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
            account_status: profile?.is_disabled ? "disabled" : "active",
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

        const timestamp = new Date().toISOString().split("T")[0];
        const filename = `pickmyclass-data-${timestamp}.json`;

        return new Response(JSON.stringify(exportData, null, 2), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "Content-Disposition": `attachment; filename="${filename}"`,
            "Cache-Control": "no-store",
          },
        });
      } catch (error) {
        log("User").error("Export error", errorFields(error));

        return fail("Failed to export data", 500);
      }
    });
  } catch (error) {
    log("User").error("Export error", errorFields(error));

    return fail("Failed to export data", 500);
  }
}
