import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { cache } from "react";

import { readAuthorizationState } from "@/lib/auth/authorization-state";
import { requirePageIdentity } from "@/lib/auth/page-session";
import { getDbFromEnv } from "@/lib/db";
import { users } from "@/lib/db/schema";

export interface AdminUser {
  id: string;
  email: string;
  clerkUserId: string;
  sessionId: string | null;
}

/** One guard execution per request render, shared by the admin layout and its page. */
export const verifyAdmin = cache(async (): Promise<AdminUser> => {
  const db = getDbFromEnv();
  const identity = await requirePageIdentity();

  const authState = await readAuthorizationState(db, identity.userId, { cache: false });

  if (authState?.is_disabled) {
    redirect("/sign-in");
  }

  if (!authState?.is_admin) {
    redirect("/dashboard");
  }

  const [row] = await db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, identity.userId))
    .limit(1);

  return {
    id: identity.userId,
    email: row?.email ?? "",
    clerkUserId: identity.clerkUserId,
    sessionId: identity.sessionId,
  };
});
