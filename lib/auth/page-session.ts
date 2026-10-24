import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";

import { getSessionIdentityFromHeaders, type SessionIdentity } from "@/lib/auth/clerk-session";

/**
 * The signed-in identity for a server-rendered page, verified once per request render.
 * `proxy.ts` gates these routes; this only resolves who is asking.
 */
export const requirePageIdentity = cache(async (): Promise<SessionIdentity> => {
  const identity = await getSessionIdentityFromHeaders(await headers());

  if (!identity) {
    redirect("/sign-in");
  }

  return identity;
});
