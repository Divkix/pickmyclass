import { invalidateAuthorizationState } from "@/lib/auth/authorization-state";
import { revokeAllUserSessions } from "@/lib/auth/clerk-session";
import { errorFields, log, logEvent } from "@/lib/log";
import { fail, ok } from "@/lib/api/response";
import { withAuth } from "@/lib/api/withAuth";
import { getDbFromEnv } from "@/lib/db";
import { softDeleteUserById } from "@/lib/db/users";

export async function DELETE(request: Request) {
  try {
    return await withAuth(request, async (user) => {
      try {
        const deletionTimestamp = new Date().toISOString();

        try {
          await softDeleteUserById(getDbFromEnv(), user.userId);
        } catch {
          return fail("Failed to delete account", 500);
        }

        invalidateAuthorizationState(user.userId);

        logEvent("account_deleted", { user_id: user.userId });

        try {
          await revokeAllUserSessions(user.clerkUserId);
        } catch (error) {
          log("User").error("Failed to revoke Clerk sessions on delete", errorFields(error));
        }

        return ok({
          message:
            "Account disabled successfully. Your data will be permanently deleted after 30 days.",
          disabled_at: deletionTimestamp,
          permanent_deletion_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        });
      } catch (error) {
        log("User").error("Delete account error", errorFields(error));

        return fail("Failed to delete account", 500);
      }
    });
  } catch (error) {
    log("User").error("Delete account error", errorFields(error));

    return fail("Failed to delete account", 500);
  }
}
