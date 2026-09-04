import { drizzle } from 'drizzle-orm/postgres-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';

import type { Database } from '@/lib/db';
import * as schema from '@/lib/db/schema';

interface CapturedStatement {
  sql: string;
  params: unknown[];
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

function createDbHarness() {
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
    next(rows: DriverRowSet = []) {
      outcomes.push(rows);
    },
    failNext(error: Error) {
      outcomes.push(error);
    },
  };
}

let h = createDbHarness();

const { mockGetDbFromEnv, mockGetSessionIdentity, mockCaptureServerEvent } = vi.hoisted(() => ({
  mockGetDbFromEnv: vi.fn(),
  mockGetSessionIdentity: vi.fn(),
  mockCaptureServerEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/auth/clerk-session', () => ({
  getSessionIdentity: mockGetSessionIdentity,
}));

vi.mock('@/lib/db', () => ({
  getDbFromEnv: (...args: unknown[]) => mockGetDbFromEnv(...args),
}));

vi.mock('@/lib/analytics/server', () => ({
  captureServerEvent: mockCaptureServerEvent,
}));

import { GET, POST } from '@/app/api/user/onboarding/route';

const identity = { userId: 'user-123', clerkUserId: 'clerk_123', sessionId: 'sess_123' };

function get(url: string): Request {
  return new Request(url);
}

function post(url: string): Request {
  return new Request(url, { method: 'POST' });
}

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

async function json(response: Response) {
  return response.json() as Promise<Record<string, JsonValue>>;
}

describe('/api/user/onboarding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    h = createDbHarness();
    mockGetDbFromEnv.mockImplementation(() => h.db);
    mockGetSessionIdentity.mockResolvedValue(identity);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('GET', () => {
    it('reports a pending state for a new user with no onboarding timestamps', async () => {
      h.next([{ onboarding_completed_at: null, onboarding_skipped_at: null }]);

      const response = await GET(get('https://pickmyclass.app/api/user/onboarding'));
      const data = await json(response);

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.onboarding_completed_at).toBeNull();
      expect(data.onboarding_skipped_at).toBeNull();
      expect(data.needs_onboarding).toBe(true);

      expect(h.statements).toHaveLength(1);
      expect(h.statements[0].sql).toContain('user_profiles');
      expect(h.statements[0].params).toEqual(['user-123', 1]);
      expect(mockGetDbFromEnv).toHaveBeenCalledTimes(1);
      expect(mockCaptureServerEvent).not.toHaveBeenCalled();
    });

    it('falls back to not-needed when the profile row is missing', async () => {
      h.next([]);

      const response = await GET(get('https://pickmyclass.app/api/user/onboarding'));
      const data = await json(response);

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.onboarding_completed_at).toBeNull();
      expect(data.onboarding_skipped_at).toBeNull();
      expect(data.needs_onboarding).toBe(false);
    });

    it('rejects unauthenticated requests without touching the database', async () => {
      mockGetSessionIdentity.mockResolvedValueOnce(null);

      const response = await GET(get('https://pickmyclass.app/api/user/onboarding'));
      const data = await json(response);

      expect(response.status).toBe(401);
      expect(data.success).toBe(false);
      expect(data.error).toBe('Unauthorized');
      expect(h.statements).toHaveLength(0);
      expect(mockGetDbFromEnv).not.toHaveBeenCalled();
    });

    it('returns 500 when the profile read fails', async () => {
      h.failNext(new Error('read failed'));

      const response = await GET(get('https://pickmyclass.app/api/user/onboarding'));
      const data = await json(response);

      expect(response.status).toBe(500);
      expect(data.success).toBe(false);
      expect(data.error).toBe('Failed to load onboarding state');
    });
  });

  describe('POST (skip)', () => {
    it('skips onboarding via the RPC and captures exactly one analytics event', async () => {
      h.next([{ onboarding_completed_at: null, onboarding_skipped_at: '2026-07-11T12:00:00Z' }]);

      const response = await POST(post('https://pickmyclass.app/api/user/onboarding'));
      const data = await json(response);

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.onboarding_completed_at).toBeNull();
      expect(data.onboarding_skipped_at).toBe('2026-07-11T12:00:00Z');
      expect(data.needs_onboarding).toBe(false);

      expect(h.statements).toHaveLength(1);
      expect(h.statements[0].sql).toContain('skip_onboarding');
      expect(h.statements[0].params).toEqual(['user-123']);

      expect(mockCaptureServerEvent).toHaveBeenCalledTimes(1);
      expect(mockCaptureServerEvent).toHaveBeenCalledWith('user-123', 'onboarding_skipped', {});
    });

    it('returns 500 when the skip RPC produces no rows and fires no analytics', async () => {
      h.next([]);

      const response = await POST(post('https://pickmyclass.app/api/user/onboarding'));
      const data = await json(response);

      expect(response.status).toBe(500);
      expect(data.success).toBe(false);
      expect(data.error).toBe('Failed to skip onboarding');
      expect(mockCaptureServerEvent).not.toHaveBeenCalled();
    });

    it('returns 500 when the skip RPC fails and fires no analytics', async () => {
      h.failNext(new Error('rpc failed'));

      const response = await POST(post('https://pickmyclass.app/api/user/onboarding'));
      const data = await json(response);

      expect(response.status).toBe(500);
      expect(data.success).toBe(false);
      expect(data.error).toBe('Failed to skip onboarding');
      expect(mockCaptureServerEvent).not.toHaveBeenCalled();
    });

    it('rejects unauthenticated requests without touching the database or analytics', async () => {
      mockGetSessionIdentity.mockResolvedValueOnce(null);

      const response = await POST(post('https://pickmyclass.app/api/user/onboarding'));
      const data = await json(response);

      expect(response.status).toBe(401);
      expect(data.success).toBe(false);
      expect(data.error).toBe('Unauthorized');
      expect(h.statements).toHaveLength(0);
      expect(mockGetDbFromEnv).not.toHaveBeenCalled();
      expect(mockCaptureServerEvent).not.toHaveBeenCalled();
    });
  });
});
