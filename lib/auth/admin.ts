import { redirect } from "@tanstack/react-router";
import { eq } from "drizzle-orm";

import { readAuthorizationState } from "@/lib/auth/authorization-state";
import { requirePageAccess } from "@/lib/auth/page-access";
import { getDbFromEnv } from "@/lib/db";
import { users } from "@/lib/db/schema";

export interface AdminUser {
  id: string;
  email: string;
  clerkUserId: string;
  sessionId: string | null;
}

/** The admin behind an admin page's server function; anyone else is redirected away. */
export async function verifyAdmin(pathname: string, search?: string): Promise<AdminUser> {
  const db = getDbFromEnv();
  const identity = await requirePageAccess(pathname, search);

  const authState = await readAuthorizationState(db, identity.userId, { cache: false });

  if (authState?.is_disabled) {
    throw redirect({ href: "/sign-in" });
  }

  if (!authState?.is_admin) {
    throw redirect({ href: "/dashboard" });
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
}
