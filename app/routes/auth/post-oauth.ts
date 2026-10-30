import { createFileRoute, redirect } from "@tanstack/react-router";
import { methodNotAllowed } from "@/lib/api/response";
import { errorFields, log } from "@/lib/log";
import { safeInternalPath } from "@/lib/auth/safe-redirect";
import { getClerkUser, getSessionIdentity } from "@/lib/auth/clerk-session";
import { getDbFromEnv } from "@/lib/db";
import { repairUserMirror } from "@/lib/db/users";

// Redirects always resolve against the request origin. `x-forwarded-host` is
// client-controllable (host-header injection / open redirect), so it must never
// influence where OAuth callbacks send the user.
function consentRedirect(base: string, next: string, saveFailed = false): Response {
  const url = new URL("/consent", base);

  if (saveFailed) url.searchParams.set("error", "save_failed");
  url.searchParams.set("next", next);

  return Response.redirect(url, 307);
}

export const Route = createFileRoute("/auth/post-oauth")({
  // Clerk's post-sign-up redirect and the gate's redirects from server functions arrive as
  // client-side navigations, which never reach the GET handler and rendered the not-found page.
  // Reload as a document request so the server handler runs; `replace` keeps Back off this hop.
  beforeLoad: ({ location }) => {
    throw redirect({ href: location.href, reloadDocument: true, replace: true });
  },
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { searchParams, origin } = new URL(request.url);
        const next = safeInternalPath(searchParams.get("next"), "/");

        const identity = await getSessionIdentity();

        if (!identity) {
          return Response.redirect(`${origin}/sign-in?error=oauth_failed`, 307);
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

          return Response.redirect(`${base}${next}`, 307);
        } catch (error) {
          log("Auth").error("post-oauth handling failed", errorFields(error));

          return Response.redirect(`${origin}/sign-in?error=oauth_failed`, 307);
        }
      },
      ANY: methodNotAllowed,
    },
  },
});
