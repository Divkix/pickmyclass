import { eq } from 'drizzle-orm';

import { TtlCache } from '@/lib/cache/ttl-cache';
import type { Database } from '@/lib/db';
import { userProfiles } from '@/lib/db/schema';
import { log } from '@/lib/log';

export interface AuthorizationState {
  has_consent: boolean;
  is_admin: boolean;
  is_disabled: boolean;
}

const CACHE_TTL_MS = 30 * 1000;
const authorizationStateCache = new TtlCache<AuthorizationState>(CACHE_TTL_MS, 100);

export function clearAuthorizationStateCache(): void {
  authorizationStateCache.clear();
}

export function invalidateAuthorizationState(userId: string): boolean {
  return authorizationStateCache.delete(userId);
}

interface ReadAuthorizationStateOptions {
  cache: boolean;
}

export async function readAuthorizationState(
  db: Database,
  userId: string,
  { cache }: ReadAuthorizationStateOptions
): Promise<AuthorizationState | null> {
  if (cache) {
    const cached = authorizationStateCache.get(userId);
    if (cached) return cached;
  }

  try {
    const [data] = await db
      .select({
        is_admin: userProfiles.is_admin,
        is_disabled: userProfiles.is_disabled,
        age_verified_at: userProfiles.age_verified_at,
        agreed_to_terms_at: userProfiles.agreed_to_terms_at,
      })
      .from(userProfiles)
      .where(eq(userProfiles.user_id, userId))
      .limit(1);

    if (!data) return null;

    const state: AuthorizationState = {
      has_consent: Boolean(data.age_verified_at && data.agreed_to_terms_at),
      is_admin: data.is_admin,
      is_disabled: data.is_disabled,
    };

    if (cache) {
      authorizationStateCache.set(userId, state);
    }

    return state;
  } catch (error) {
    log('Auth').error('Error reading authorization state:', error);
    return { is_admin: false, is_disabled: true, has_consent: false };
  }
}
