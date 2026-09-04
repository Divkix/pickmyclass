import { drizzle } from 'drizzle-orm/postgres-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';

import { verifyAdmin } from '@/lib/auth/admin';
import type { Database } from '@/lib/db';
import * as schema from '@/lib/db/schema';

interface CapturedStatement {
  sql: string;
  params: unknown[];
}

interface AdminMirrorRow {
  [column: string]: PgWireValue;
  email: string;
}

type PgWireValue =
  | string
  | number
  | boolean
  | null
  | PgWireValue[]
  | { [column: string]: PgWireValue };

type DriverRowSet = Array<Record<string, PgWireValue>>;

interface ScriptedPendingRows {
  then(
    onFulfilled?: (value: never) => PromiseLike<never>,
    onRejected?: (reason: Error) => PromiseLike<never>
  ): Promise<never>;
  catch(onRejected: (reason: Error) => PromiseLike<never>): Promise<never>;
  values(): PromiseLike<never[]>;
}

type ScriptedRows = Promise<DriverRowSet> & { values(): PromiseLike<unknown[][]> };

type ScriptedQueryResult = ScriptedPendingRows | ScriptedRows;

interface PostgresJsSeam {
  unsafe(query: string, params: unknown[]): ScriptedQueryResult;
}

function createDbDouble() {
  const statements: CapturedStatement[] = [];
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
  const db = drizzle(client as Database['$client'], { schema });

  return {
    db,
    statements,
    nextRows(rows: AdminMirrorRow[] = []) {
      outcomes.push(rows);
    },
  };
}

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

    expect(mockReadAuthorizationState).toHaveBeenCalledWith(double.db, 'user-123', {
      cache: false,
    });

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
    double.nextRows([]);

    const result = await verifyAdmin(double.db);

    expect(result.email).toBe('');
    expect(mockRedirect).not.toHaveBeenCalled();
  });
});
