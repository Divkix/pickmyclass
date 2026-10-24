import { NextResponse } from "next/server";
import { errorFields, log } from "@/lib/log";
import { safeInternalPath } from "@/lib/auth/safe-redirect";
import { getClerkUser, getSessionIdentity } from "@/lib/auth/clerk-session";
import { getDbFromEnv } from "@/lib/db";
import { repairUserMirror } from "@/lib/db/users";

// Redirects always resolve against the request origin. `x-forwarded-host` is
// client-controllable (host-header injection / open redirect), so it must never
// influence where OAuth callbacks send the user.
function consentRedirect(base: string, next: string, saveFailed = false): NextResponse {
  const url = new URL("/consent", base);

  if (saveFailed) url.searchParams.set("error", "save_failed");
  url.searchParams.set("next", next);

  return NextResponse.redirect(url);
}

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const next = safeInternalPath(searchParams.get("next"), "/");

  const identity = await getSessionIdentity(request);

  if (!identity) {
    return NextResponse.redirect(`${origin}/sign-in?error=oauth_failed`);
  }

  const base = origin;
  const userId = identity.userId;

  try {
    const db = getDbFromEnv();
    const clerkUser = await getClerkUser(identity.clerkUserId);
    const repairResult = await repairUserMirror(db, userId, clerkUser);

    if (!repairResult) {
      log("Auth").error("No primary email on Clerk user", {
        clerk_user_id: identity.clerkUserId,
      });

      return consentRedirect(base, next, true);
    }

    // Consent is recorded only by the checkbox form's authenticated POST, never a navigation URL.
    if (!repairResult.hasConsent) {
      return consentRedirect(base, next);
    }

    return NextResponse.redirect(`${base}${next}`);
  } catch (error) {
    log("Auth").error("post-oauth handling failed", errorFields(error));

    return NextResponse.redirect(`${origin}/sign-in?error=oauth_failed`);
  }
}
