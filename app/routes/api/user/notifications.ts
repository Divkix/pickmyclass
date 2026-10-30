/**
 * Signed-in users read and change only their own global email-alert preference.
 * Start's global CSRF middleware protects PATCH. Pausing matches email unsubscribe;
 * resuming clears its timestamp but never clears bounce or spam delivery blocks.
 */
import { createFileRoute } from "@tanstack/react-router";
import { eq, sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import { z } from "zod";
import { fail, methodNotAllowed, ok } from "@/lib/api/response";
import { parseJsonOrFail } from "@/lib/api/validation";
import { withAuth } from "@/lib/api/withAuth";
import { getDbFromEnv } from "@/lib/db";
import { userProfiles } from "@/lib/db/schema";
import { errorFields, log, logEvent } from "@/lib/log";

const notificationPreferenceSchema = z.object({ notifications_enabled: z.boolean() }).strict();

const preferenceFields = {
  notifications_enabled: userProfiles.notifications_enabled,
  email_bounced: userProfiles.email_bounced,
  spam_complained: userProfiles.spam_complained,
};

export const Route = createFileRoute("/api/user/notifications")({
  server: {
    handlers: {
      GET: async () => {
        try {
          return await withAuth(async (user) => {
            const [preference] = await getDbFromEnv()
              .select(preferenceFields)
              .from(userProfiles)
              .where(eq(userProfiles.user_id, user.userId))
              .limit(1);

            if (!preference) return fail("Notification preferences not found", 404);

            return ok(preference, { headers: { "Cache-Control": "no-store" } });
          });
        } catch (error) {
          log("Settings").error("Failed to read email alert preference", errorFields(error));

          return fail("Failed to read email alert preference", 500);
        }
      },
      PATCH: async ({ request }) => {
        try {
          return await withAuth(async (user) => {
            const parsed = await parseJsonOrFail(notificationPreferenceSchema, request);

            if (!parsed.success) return parsed.response;

            const { notifications_enabled } = parsed.data;

            const [preference] = await getDbFromEnv()
              .update(userProfiles)
              .set({
                notifications_enabled,
                unsubscribed_at: notifications_enabled ? null : sql`now()`,
              })
              .where(eq(userProfiles.user_id, user.userId))
              .returning(preferenceFields);

            if (!preference) return fail("Notification preferences not found", 404);

            logEvent(notifications_enabled ? "user_resubscribed" : "user_unsubscribed", {
              user_id_hash: createHash("sha256").update(user.userId).digest("hex"),
              method: "settings",
            });

            return ok(preference, { headers: { "Cache-Control": "no-store" } });
          });
        } catch (error) {
          log("Settings").error("Failed to update email alert preference", errorFields(error));

          return fail("Failed to update email alert preference", 500);
        }
      },
      ANY: methodNotAllowed,
    },
  },
});
