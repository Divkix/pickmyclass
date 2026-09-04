import { eq } from 'drizzle-orm';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { readAuthorizationState } from '@/lib/auth/authorization-state';
import { getSessionIdentityFromHeaders } from '@/lib/auth/clerk-session';
import type { Database } from '@/lib/db';
import { users } from '@/lib/db/schema';

export interface AdminUser {
  id: string;
  email: string;
  clerkUserId: string;
  sessionId: string | null;
}

export async function verifyAdmin(db: Database): Promise<AdminUser> {
  const headerStore = await headers();
  const identity = await getSessionIdentityFromHeaders(headerStore);

  if (!identity) {
    redirect('/sign-in');
  }

  const authState = await readAuthorizationState(db, identity.userId, { cache: false });

  if (authState?.is_disabled) {
    redirect('/sign-in');
  }

  if (!authState?.is_admin) {
    redirect('/dashboard');
  }

  const [row] = await db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, identity.userId))
    .limit(1);

  return {
    id: identity.userId,
    email: row?.email ?? '',
    clerkUserId: identity.clerkUserId,
    sessionId: identity.sessionId,
  };
}
