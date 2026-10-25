import { redirect } from "@tanstack/react-router";
import { setResponseHeader } from "@tanstack/react-start/server";
import { clearClerkCookies } from "@/lib/auth/clerk-cookies";
import { type SessionIdentity, getSessionIdentity } from "@/lib/auth/clerk-session";
import { evaluateGate, revokeSessionQuietly } from "@/lib/auth/request-gate";

/**
 * The edge gate's decision for a protected page, enforced by the page's own
 * server function. Client-side navigations reach the server only through
 * server functions, never with the page's path, so the request middleware
 * cannot gate them. `pathname` is the page's own route, never client input.
 */
export async function requirePageAccess(pathname: string, search = ""): Promise<SessionIdentity> {
  const identity = await getSessionIdentity();
  const decision = await evaluateGate(pathname, search, identity);

  switch (decision.kind) {
    case "signout-and-redirect": {
      await revokeSessionQuietly(identity);
      const cleared = new Headers();
      clearClerkCookies(cleared);
      setResponseHeader("Set-Cookie", cleared.getSetCookie());

      throw redirect({ href: decision.to });
    }

    case "redirect":
      throw redirect({ href: decision.to });

    case "forbidden":
      // decideGate only forbids API paths.
      throw new Error(decision.message);

    case "allow":
      // decideGate sends anonymous visitors on a protected path to /sign-in.
      if (!identity) throw redirect({ href: "/sign-in" });

      return identity;
  }
}
