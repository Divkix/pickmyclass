import { sql } from "drizzle-orm";
import { type NextRequest } from "next/server";
import { consentSchema } from "@/lib/api/schemas";
import { fail, ok } from "@/lib/api/response";
import { parseJsonOrFail } from "@/lib/api/validation";
import { withAuth } from "@/lib/api/withAuth";
import { invalidateAuthorizationState } from "@/lib/auth/authorization-state";
import { getClerkUser } from "@/lib/auth/clerk-session";
import { getDbFromEnv } from "@/lib/db";
import { repairUserMirror } from "@/lib/db/users";
import { errorFields, log } from "@/lib/log";

export async function POST(request: NextRequest) {
  try {
    return await withAuth(request, async (user) => {
      const parsed = await parseJsonOrFail(consentSchema, request);

      if (!parsed.success) {
        return parsed.response;
      }

      const db = getDbFromEnv();
      const clerkUser = await getClerkUser(user.clerkUserId);
      const result = await repairUserMirror(db, user.userId, clerkUser);

      if (!result) {
        log("Consent").error("No primary email on Clerk user", {
          clerk_user_id: user.clerkUserId,
        });

        return fail("Account setup incomplete — please try again in a moment", 409);
      }

      await db.execute(sql`SELECT public.accept_terms_and_verify_age(${user.userId}::text)`);

      invalidateAuthorizationState(user.userId);

      return ok(null);
    });
  } catch (error) {
    log("Consent").error("Failed to persist consent", errorFields(error));

    return fail("Could not save consent", 500);
  }
}
