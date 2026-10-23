import { type NextRequest } from "next/server";
import { ok } from "@/lib/api/response";
import { clearClerkCookies } from "@/lib/auth/clerk-cookies";
import { getSessionIdentity, revokeSession } from "@/lib/auth/clerk-session";
import { errorFields, log } from "@/lib/log";

export async function POST(request: NextRequest) {
  try {
    const identity = await getSessionIdentity(request);

    if (identity?.sessionId) {
      try {
        await revokeSession(identity.sessionId);
      } catch (error) {
        log("Auth").warn("Failed to revoke Clerk session", errorFields(error));
      }
    }
  } catch (error) {
    log("Auth").warn("Sign-out session lookup failed", errorFields(error));
  }

  const response = ok(null);

  clearClerkCookies(response);

  return response;
}
