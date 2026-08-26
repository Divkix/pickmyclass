/**
 * Unit tests for `verifyAdmin` (Clerk edition).
 *
 * verifyAdmin performs DB reads, so it takes a request-scoped Drizzle handle
 * first and forwards it to the fresh authorization read and the users-mirror
 * email lookup. These tests pin:
 * - redirect behavior: unauthenticated → /sign-in, disabled → /sign-in,
 *   non-admin → /dashboard
 * - the fresh (never cached) authorization read keyed by identity.userId
 * - the same db handle threading through both reads
 * - the compat AdminUser shape with mirror-email fallback to ''
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';

import { verifyAdmin } from '@/lib/auth/admin';
import type { Database } from '@/lib/db';
import * as schema from '@/lib/db/schema';

// ---------------------------------------------------------------------------
// Scripted postgres-js transport (Drizzle builders render real SQL)
// ---------------------------------------------------------------------------

interface CapturedStatement {
  sql: string;
  params: unknown[];
}

/** users-mirror columns in verifyAdmin's SELECT order. */
interface AdminMirrorRow {
  [column: string]: PgWireValue;
  email: string;
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
    /** Queue the mirror row answered by the next select (empty = no row). */
    nextRows(rows: AdminMirrorRow[] = []) {
      outcomes.push(rows);
    },
  };
}

// ---------------------------------------------------------------------------

const { mockGetSessionIdentityFromHeaders, mockReadAuthorizationState, mockRedirect, mockHeaders } =
  vi.hoisted(() => ({
    mockGetSessionIdentityFromHeaders: vi.fn(),
    mockReadAuthorizationState: vi.fn(),
    mockRedirect: vi.fn((path: string) => {
      throw new Error(`redirect:${path}`);
    }),
    mockHeaders: vi.fn(),
  }));

vi.mock('next/navigation', () => ({
  redirect: mockRedirect,
}));

vi.mock('next/headers', () => ({
  headers: mockHeaders,
}));

vi.mock('@/lib/auth/clerk-session', () => ({
  getSessionIdentityFromHeaders: mockGetSessionIdentityFromHeaders,
}));

vi.mock('@/lib/auth/authorization-state', () => ({
  readAuthorizationState: mockReadAuthorizationState,
}));

const identity = { userId: 'user-123', clerkUserId: 'clerk_123', sessionId: 'sess_123' };

/** The scripted-handle seam createDbDouble hands to verifyAdmin and spies. */
interface AdminDbDouble {
  db: Database;
  statements: CapturedStatement[];
  nextRows(rows?: AdminMirrorRow[]): void;
}

describe('verifyAdmin', () => {
  let double: AdminDbDouble;

  beforeEach(() => {
    vi.clearAllMocks();
    double = createDbDouble();
    mockHeaders.mockResolvedValue(new Headers());
    mockGetSessionIdentityFromHeaders.mockResolvedValue(identity);
    mockReadAuthorizationState.mockResolvedValue({
      is_admin: true,
      is_disabled: false,
      has_consent: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns the authenticated user when their profile is marked admin', async () => {
    double.nextRows([{ email: 'admin@example.com' }]);

    const result = await verifyAdmin(double.db);

    expect(result.email).toBe('admin@example.com');
    expect(result.clerkUserId).toBe('clerk_123');
    expect(result.sessionId).toBe('sess_123');
    expect(mockRedirect).not.toHaveBeenCalled();

    // Fresh (cache:false) authorization read, threaded through the SAME db handle.
    expect(mockReadAuthorizationState).toHaveBeenCalledWith(double.db, 'user-123', {
      cache: false,
    });

    // Email resolved from the users mirror by app id: one wire-level assertion
    // pins the table, the single-column projection, and the id filter.
    expect(double.statements).toHaveLength(1);
    const [statement] = double.statements;
    expect(statement.sql.replace(/\s+/g, ' ').trim()).toBe(
      'select "email" from "users" where "users"."id" = $1 limit $2'
    );
    expect(statement.params).toEqual(['user-123', 1]);
  });

  it('redirects unauthenticated users to sign-in without touching the database', async () => {
    mockGetSessionIdentityFromHeaders.mockResolvedValueOnce(null);

    await expect(verifyAdmin(double.db)).rejects.toThrow('redirect:/sign-in');
    expect(mockRedirect).toHaveBeenCalledWith('/sign-in');
    expect(mockReadAuthorizationState).not.toHaveBeenCalled();
    expect(double.statements).toHaveLength(0);
  });

  it('redirects disabled admins to sign-in via the fail-closed state', async () => {
    mockReadAuthorizationState.mockResolvedValueOnce({
      is_admin: false,
      is_disabled: true,
      has_consent: false,
    });

    await expect(verifyAdmin(double.db)).rejects.toThrow('redirect:/sign-in');
    expect(mockRedirect).toHaveBeenCalledWith('/sign-in');
    expect(double.statements).toHaveLength(0);
  });

  it('redirects authenticated non-admin users to the dashboard', async () => {
    mockReadAuthorizationState.mockResolvedValueOnce({
      is_admin: false,
      is_disabled: false,
      has_consent: true,
    });

    await expect(verifyAdmin(double.db)).rejects.toThrow('redirect:/dashboard');
    expect(mockRedirect).toHaveBeenCalledWith('/dashboard');
    expect(double.statements).toHaveLength(0);
  });

  it('falls back to an empty display email when the mirror row is missing', async () => {
    // No queued rows: the select resolves to [] and row?.email ?? '' applies.
    double.nextRows([]);

    const result = await verifyAdmin(double.db);

    expect(result.email).toBe('');
    expect(mockRedirect).not.toHaveBeenCalled();
  });
});
