/**
 * Authorization State — the profile fields that gate access to the app.
 *
 * The server state is read by the edge proxy, `verifyAdmin`, and the login route.
 * Those readers used to
 * re-implement the query with divergent column sets and error handling, and only
 * the edge proxy cached it. This module owns the server read, its 30s per-isolate
 * cache, and its invalidation, exposing a **cached** read (edge) and a **fresh**
 * read (admin/login).
 *
 * The deliberate cached-vs-fresh split is preserved (see
 * `docs/adr/0001-authorization-state-boundary.md`): `proxy.ts` may serve a
 * 30s-stale decision (a CPU saver), while `verifyAdmin` and login read live so
 * disabling an admin is enforced immediately. The browser `AuthContext` read is
 * intentionally left out — it is a UI affordance only, and this per-isolate cache
 * cannot cross into the browser.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { TtlCache } from '@/lib/cache/ttl-cache';
import { log } from '@/lib/log';
import type { Database } from '@/lib/supabase/database.types';

/**
 * The authorization decision for a user: role, disabled state, and whether both
 * required legal-consent timestamps exist.
 */
export interface AuthorizationState {
  has_consent: boolean;
  is_admin: boolean;
  is_disabled: boolean;
}

/** Per-isolate authorization cache with a 30-second TTL. */
const CACHE_TTL_MS = 30 * 1000;
const authorizationStateCache = new TtlCache<AuthorizationState>(CACHE_TTL_MS, 100);

/** Clear the entire authorization cache. Exposed for test isolation. */
export function clearAuthorizationStateCache(): void {
  authorizationStateCache.clear();
}

/**
 * Invalidate the cached authorization state for a specific user. Call after
 * mutating an authorization field (`is_admin` / `is_disabled`) or recording
 * consent so the next cached read re-queries instead of serving a stale decision.
 * Returns `true` if an entry existed.
 */
export function invalidateAuthorizationState(userId: string): boolean {
  return authorizationStateCache.delete(userId);
}

/** Options for {@link readAuthorizationState}. */
interface ReadAuthorizationStateOptions {
  /**
   * `true` — the edge read: serve a cached decision (up to 30s stale) and cache a
   * fresh one on a miss. `false` — the admin/login read: always query live and
   * never touch the cache.
   */
  cache: boolean;
}

/**
 * Read a user's {@link AuthorizationState}.
 *
 * With `{ cache: true }` this returns a cached decision on a hit and populates the
 * cache on a miss (the edge proxy). With `{ cache: false }` it always queries live
 * and bypasses the cache entirely (`verifyAdmin` and the login route), so a
 * disabled or demoted account is enforced immediately on those gates.
 *
 * Returns `null` when the user has no profile row or the query errors — every
 * caller treats a `null` state as "not admin, not disabled".
 */
export async function readAuthorizationState(
  client: SupabaseClient<Database>,
  userId: string,
  { cache }: ReadAuthorizationStateOptions
): Promise<AuthorizationState | null> {
  if (cache) {
    const cached = authorizationStateCache.get(userId);
    if (cached) return cached;
  }

  try {
    const { data } = await client
      .from('user_profiles')
      .select('is_admin, is_disabled, age_verified_at, agreed_to_terms_at')
      .eq('user_id', userId)
      .maybeSingle();

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
    return null;
  }
}
