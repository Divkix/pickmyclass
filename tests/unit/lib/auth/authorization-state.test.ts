/**
 * Unit tests for the authorization-state owner (ADR 0001).
 *
 * The module owns the server read of `user_profiles` gating fields, its 30s
 * per-isolate cache, and its invalidation. These tests pin:
 * - the cached/fresh split (cached hit skips the query; fresh never touches
 *   the cache in either direction)
 * - the fail-closed error mapping (error results are never cached)
 * - consent requiring BOTH timestamps
 * - the rendered query shape: `user_profiles` projected to the gate columns,
 *   filtered by `user_id`
 *
 * The DB seam is REAL Drizzle builders over a scripted postgres-js transport;
 * every statement lands in `statements[]` exactly as the wire would see it.
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';

import {
  type AuthorizationState,
  clearAuthorizationStateCache,
  invalidateAuthorizationState,
  readAuthorizationState,
} from '@/lib/auth/authorization-state';
import type { Database } from '@/lib/db';
import * as schema from '@/lib/db/schema';

// ---------------------------------------------------------------------------
// Scripted postgres-js transport (Drizzle builders render real SQL)
// ---------------------------------------------------------------------------

interface CapturedStatement {
  sql: string;
  params: unknown[];
}

/** user_profiles gate columns in readAuthorizationState's SELECT order. */
interface ProfileGateRow {
  [column: string]: PgWireValue;
  is_admin: boolean;
  is_disabled: boolean;
  age_verified_at: string | null;
  agreed_to_terms_at: string | null;
}

/** Driver rows as Drizzle's postgres-js session sees them: keyed objects. */
type PgWireValue =
  | string
  | number
  | boolean
  | null
  | PgWireValue[]
  | { [column: string]: PgWireValue };

/** Driver rows as Drizzle's postgres-js session sees them: keyed objects. */
type DriverRowSet = Array<Record<string, PgWireValue>>;

/**
 * Lazy-rejection surface mirroring postgres-js PendingQuery: driver errors
 * surface only when Drizzle awaits the query or reads `.values()`.
 */
interface ScriptedPendingRows {
  then(
    onFulfilled?: (value: never) => PromiseLike<never>,
    onRejected?: (reason: Error) => PromiseLike<never>
  ): Promise<never>;
  catch(onRejected: (reason: Error) => PromiseLike<never>): Promise<never>;
  values(): PromiseLike<never[]>;
}

/** Resolved rows carrying the positional `.values()` Drizzle maps fields from. */
type ScriptedRows = Promise<DriverRowSet> & { values(): PromiseLike<unknown[][]> };

/** Everything Drizzle's postgres-js session consumes from `unsafe()`. */
type ScriptedQueryResult = ScriptedPendingRows | ScriptedRows;

/** Minimal postgres-js members Drizzle's session drives end to end. */
interface PostgresJsSeam {
  unsafe(query: string, params: unknown[]): ScriptedQueryResult;
}

function createDbDouble() {
  const statements: CapturedStatement[] = [];
  // FIFO of per-statement outcomes: row sets and driver errors in call order.
  const outcomes: Array<DriverRowSet | Error> = [];

  const pendingRows = (rows: DriverRowSet): ScriptedRows =>
    Object.assign(Promise.resolve(rows), {
      values: () => Promise.resolve(rows.map((row) => Object.values(row))),
    });

  const scriptedClient = {
    options: { parsers: {}, serializers: {} },
    unsafe(query: string, params: unknown[]): ScriptedQueryResult {
      statements.push({ sql: query, params });
      const outcome = outcomes.shift();
      if (outcome instanceof Error) {
        // Lazy rejection mirroring postgres-js PendingQuery: drizzle reads
        // `.values()` synchronously, and the rejection may only surface when
        // awaited — an eagerly-rejected promise would go unhandled.
        const reject = (): Promise<never> => Promise.reject(outcome);
        return {
          then: (
            onFulfilled?: (value: never) => PromiseLike<never>,
            onRejected?: (reason: Error) => PromiseLike<never>
          ) => reject().then(onFulfilled, onRejected),
          catch: (onRejected: (reason: Error) => PromiseLike<never>) => reject().catch(onRejected),
          values: reject,
        };
      }
      return pendingRows(outcome ?? []);
    },
    begin<T>(fn: (txClient: PostgresJsSeam) => Promise<T>): Promise<T> {
      return fn(scriptedClient);
    },
  };

  const client: PostgresJsSeam = scriptedClient;
  // SAFETY: the double implements exactly the postgres-js seams Drizzle's
  // session drives (tag-call unsafe(), .values(), begin()); the rest of the
  // Sql surface is unreachable through Drizzle builders.
  const db = drizzle(client as Database['$client'], { schema });

  return {
    db,
    statements,
    /** Queue the profile row answered by the next select (empty = no row). */
    nextRows(rows: ProfileGateRow[] = []) {
      outcomes.push(rows);
    },
    /** Make the next executed statement reject with this driver-shaped error. */
    failNext(error: Error) {
      outcomes.push(error);
    },
  };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const consentTimestamp = '2026-07-12T00:00:00.000Z';
const adminProfile: ProfileGateRow = {
  is_admin: true,
  is_disabled: false,
  age_verified_at: consentTimestamp,
  agreed_to_terms_at: consentTimestamp,
};
const regularProfile: ProfileGateRow = {
  is_admin: false,
  is_disabled: false,
  age_verified_at: consentTimestamp,
  agreed_to_terms_at: consentTimestamp,
};
const adminState: AuthorizationState = {
  is_admin: true,
  is_disabled: false,
  has_consent: true,
};

describe('readAuthorizationState', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    clearAuthorizationStateCache();
  });

  afterEach(() => {
    clearAuthorizationStateCache();
    vi.restoreAllMocks();
  });

  it('returns authorization and consent state from the profile row', async () => {
    const double = createDbDouble();
    double.nextRows([adminProfile]);

    const state = await readAuthorizationState(double.db, 'user-1', { cache: false });

    expect(state).toEqual(adminState);
  });

  it('queries user_profiles projected to the four gate columns, filtered by user_id', async () => {
    const double = createDbDouble();
    double.nextRows([regularProfile]);

    await readAuthorizationState(double.db, 'user-1', { cache: false });

    expect(double.statements).toHaveLength(1);
    const [statement] = double.statements;
    // Rendered SQL pins the table, the four-column gate projection, the
    // user_id filter, and LIMIT 1 in one wire-level assertion.
    expect(statement.sql.replace(/\s+/g, ' ').trim()).toBe(
      'select "is_admin", "is_disabled", "age_verified_at", "agreed_to_terms_at" ' +
        'from "user_profiles" where "user_profiles"."user_id" = $1 limit $2'
    );
    expect(statement.params).toEqual(['user-1', 1]);
  });

  it('requires both age verification and terms agreement for consent', async () => {
    const double = createDbDouble();
    double.nextRows([{ ...regularProfile, agreed_to_terms_at: null }]);

    const state = await readAuthorizationState(double.db, 'user-1', { cache: false });

    expect(state?.has_consent).toBe(false);
  });

  it('returns null when the profile row is missing', async () => {
    const double = createDbDouble();

    const state = await readAuthorizationState(double.db, 'user-1', { cache: false });

    expect(state).toBeNull();
  });

  it('returns fail-closed state and logs when the query throws', async () => {
    const double = createDbDouble();
    double.failNext(new Error('db down'));

    const state = await readAuthorizationState(double.db, 'user-1', { cache: false });

    expect(state).toEqual({ is_admin: false, is_disabled: true, has_consent: false });
    expect(console.error).toHaveBeenCalled();
  });

  describe('cached read', () => {
    it('serves a cached hit without re-querying', async () => {
      const double = createDbDouble();
      double.nextRows([adminProfile]);

      await readAuthorizationState(double.db, 'user-1', { cache: true });
      const second = await readAuthorizationState(double.db, 'user-1', { cache: true });

      expect(second).toEqual(adminState);
      expect(double.statements).toHaveLength(1);
    });

    it('does not cache a null (missing profile) result', async () => {
      const double = createDbDouble();

      await readAuthorizationState(double.db, 'user-1', { cache: true });
      await readAuthorizationState(double.db, 'user-1', { cache: true });

      expect(double.statements).toHaveLength(2);
    });
  });

  describe('fresh read', () => {
    it('always queries even after a value was cached', async () => {
      const double = createDbDouble();
      double.nextRows([adminProfile]);

      await readAuthorizationState(double.db, 'user-1', { cache: true });
      double.nextRows([adminProfile]);
      await readAuthorizationState(double.db, 'user-1', { cache: false });

      expect(double.statements).toHaveLength(2);
    });

    it('does not populate the cache, so a later cached read still queries', async () => {
      const double = createDbDouble();
      double.nextRows([adminProfile]);

      await readAuthorizationState(double.db, 'user-1', { cache: false });
      await readAuthorizationState(double.db, 'user-1', { cache: true });

      expect(double.statements).toHaveLength(2);
    });
  });

  describe('invalidateAuthorizationState', () => {
    it('forces the next cached read to re-query', async () => {
      const double = createDbDouble();
      double.nextRows([adminProfile]);

      await readAuthorizationState(double.db, 'user-1', { cache: true });
      const removed = invalidateAuthorizationState('user-1');
      await readAuthorizationState(double.db, 'user-1', { cache: true });

      expect(removed).toBe(true);
      expect(double.statements).toHaveLength(2);
    });

    it('returns false when nothing was cached for that user', () => {
      expect(invalidateAuthorizationState('never-cached')).toBe(false);
    });
  });

  it('never caches the fail-closed error state', async () => {
    const double = createDbDouble();
    double.failNext(new Error('db down'));

    await readAuthorizationState(double.db, 'user-1', { cache: true });

    // The error path must not poison the cache: after recovery the next cached
    // read re-queries instead of serving the closed decision.
    double.nextRows([adminProfile]);
    const recovered = await readAuthorizationState(double.db, 'user-1', { cache: true });

    expect(recovered).toEqual(adminState);
    expect(double.statements).toHaveLength(2);
  });
});
