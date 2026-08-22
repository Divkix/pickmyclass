import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';

type JsonValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | JsonValue[]
  | { [key: string]: JsonValue };

type HealthRouteOptions = {
  envOverrides?: Record<string, JsonValue>;
  dbThrows?: boolean;
  dbResult?: { error: { message: string } | null } | null;
  asuError?: Error;
  doThrows?: boolean;
  lockTimestamps?: { acquiredAt: number; expiresAt: number };
};
const baseEnv = {
  ASU_API_BASE_URL: 'https://classes.example.test',
  ASU_API_TOKEN: 'test-token',
  CRON_SECRET: 'test-cron-secret',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
  SUPABASE_SEND_EMAIL_HOOK_SECRET: 'whsec_test',
  EMAIL: { send: vi.fn() },
  NOTIFICATION_FROM_EMAIL: 'notifications@pickmyclass.app',
};

async function loadHealthRoute(options: HealthRouteOptions = {}) {
  vi.resetModules();

  const doBinding = {};
  const env = {
    ...baseEnv,
    PICKMYCLASS_CRON_LOCK_DO: doBinding,
    ...options.envOverrides,
  };

  vi.doMock('cloudflare:workers', () => ({ env }));

  const lockStatus = vi.fn(async () => {
    if (options.doThrows) throw new Error('DO down');
    if (!env.PICKMYCLASS_CRON_LOCK_DO) return null;
    return {
      locked: true,
      lockHolder: 'cron-run',
      lockAcquiredAt: options.lockTimestamps?.acquiredAt ?? Date.now() - 1000,
      timeHeldMs: 1000,
      expiresAt: options.lockTimestamps?.expiresAt ?? Date.now() + 1000,
    };
  });
  const createCronLockClient = vi.fn(() => ({ status: lockStatus }));
  vi.doMock('@/lib/worker/cron-lock', () => ({ createCronLockClient }));

  class MockNotFoundError extends Error {}
  const fetchClassFromASU = vi.fn();
  if (options.asuError) {
    fetchClassFromASU.mockRejectedValue(options.asuError);
  } else {
    fetchClassFromASU.mockRejectedValue(new MockNotFoundError('not found but reachable'));
  }
  vi.doMock('@/lib/asu/api', () => ({
    fetchClassFromASU,
    NotFoundError: MockNotFoundError,
  }));

  // Data plane now goes through lib/db/client (queryOne replaces the old
  // service .from('class_watches').select().limit() probe).
  const queryOne = vi.fn(async () => {
    if (options.dbThrows) {
      throw new Error('service unavailable');
    }
    if (options.dbResult?.error) {
      throw new Error(options.dbResult.error.message);
    }
    return { id: 'probe-row' };
  });
  vi.doMock('@/lib/db/client', () => ({
    queryOne,
    query: vi.fn(),
    queryScalar: vi.fn(),
    execute: vi.fn(),
    callFunction: vi.fn(),
    callFunctionScalar: vi.fn(),
    getClient: vi.fn(),
    setConnectionStringGetter: vi.fn(),
  }));

  const mod = await import('@/app/api/monitoring/health/route');
  return {
    GET: mod.GET,
    createCronLockClient,
    doBinding,
    fetchClassFromASU,
    queryOne,
    lockStatus,
  };
}

function request(auth = 'Bearer test-cron-secret') {
  return new NextRequest('https://pickmyclass.app/api/monitoring/health', {
    headers: auth ? { authorization: auth } : {},
  });
}

describe('GET /api/monitoring/health branch coverage', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    vi.doUnmock('cloudflare:workers');
    vi.doUnmock('@/lib/asu/api');
    vi.doUnmock('@/lib/db/client');
    vi.doUnmock('@/lib/worker/cron-lock');
  });

  it('returns a cheap liveness probe without auth', async () => {
    const { GET, queryOne } = await loadHealthRoute();

    const response = await GET(request(''));
    // SAFETY: response.json() from mocked health route has known status shape in this branch
    const data = (await response.json()) as { status: string };

    expect(response.status).toBe(200);
    expect(data.status).toBe('ok');
    expect(queryOne).not.toHaveBeenCalled();
  });

  it('reports healthy detailed checks with a configured cron lock durable object', async () => {
    vi.stubEnv('CRON_SECRET', '');
    const { GET, createCronLockClient, doBinding, lockStatus } = await loadHealthRoute();

    const response = await GET(request());
    // SAFETY: mocked health route returns healthy detailed checks matching this typed shape
    const data = (await response.json()) as {
      status: string;
      checks: {
        database: { status: string };
        asu_api: { status: string };
        configuration: { status: string };
        email: { status: string; configured: boolean };
        cron_lock: { status: string; locked: boolean; lock_holder: string };
      };
    };

    expect(response.status).toBe(200);
    expect(data.status).toBe('healthy');
    expect(data.checks.database.status).toBe('healthy');
    expect(data.checks.asu_api.status).toBe('healthy');
    expect(data.checks.configuration.status).toBe('healthy');
    expect(data.checks.email).toEqual({ status: 'healthy', configured: true });
    expect(data.checks.cron_lock).toMatchObject({
      status: 'healthy',
      locked: true,
      lock_holder: 'cron-run',
    });
    expect(createCronLockClient).toHaveBeenCalledWith(doBinding);
    expect(lockStatus).toHaveBeenCalledOnce();
  });

  it('formats epoch lock timestamps instead of treating them as absent', async () => {
    const { GET } = await loadHealthRoute({
      lockTimestamps: { acquiredAt: 0, expiresAt: 1 },
    });

    const response = await GET(request());
    // SAFETY: mocked health route returns cron_lock timestamps matching this typed shape
    const data = (await response.json()) as {
      checks: {
        cron_lock: { lock_acquired_at: string | null; expires_at: string | null };
      };
    };

    expect(data.checks.cron_lock.lock_acquired_at).toBe('1970-01-01T00:00:00.000Z');
    expect(data.checks.cron_lock.expires_at).toBe('1970-01-01T00:00:00.001Z');
  });

  it('caches detailed health checks for repeated authenticated requests', async () => {
    const { GET, queryOne } = await loadHealthRoute();

    await GET(request());
    await GET(request());

    expect(queryOne).toHaveBeenCalledTimes(1);
  });

  it('reports degraded checks when database, ASU, and cron lock checks fail', async () => {
    const { GET } = await loadHealthRoute({
      dbResult: { error: { message: 'database rejected query' } },
      asuError: new Error('ASU unavailable'),
      doThrows: true,
    });

    const response = await GET(request());
    // SAFETY: mocked health route returns degraded checks matching this typed record shape
    const data = (await response.json()) as {
      status: string;
      checks: Record<string, { status?: string; error?: string }>;
    };

    expect(response.status).toBe(503);
    expect(data.status).toBe('degraded');
    expect(data.checks.database).toMatchObject({
      status: 'unhealthy',
      error: 'database rejected query',
    });
    expect(data.checks.asu_api).toMatchObject({ status: 'unhealthy', error: 'ASU unavailable' });
    expect(data.checks.cron_lock).toMatchObject({ status: 'unhealthy', error: 'DO down' });
  });

  it('reports unhealthy checks for service exceptions and missing config', async () => {
    const { GET } = await loadHealthRoute({
      dbThrows: true,
      envOverrides: {
        SUPABASE_SERVICE_ROLE_KEY: undefined,
        ASU_API_BASE_URL: undefined,
        ASU_API_TOKEN: undefined,
        SUPABASE_SEND_EMAIL_HOOK_SECRET: undefined,
        EMAIL: undefined,
        NOTIFICATION_FROM_EMAIL: undefined,
        PICKMYCLASS_CRON_LOCK_DO: undefined,
      },
    });

    const response = await GET(request());
    // SAFETY: mocked health route returns unhealthy checks matching this typed record shape
    const data = (await response.json()) as {
      status: string;
      checks: Record<string, { status?: string; missing_vars?: string[]; missing?: string[] }>;
    };

    expect(response.status).toBe(500);
    expect(data.status).toBe('unhealthy');
    expect(data.checks.database).toMatchObject({
      status: 'unhealthy',
      error: 'service unavailable',
    });
    expect(data.checks.configuration.missing_vars).toEqual(
      // The data-plane migration dropped Supabase-specific secrets from the
      // health route's required-env-var list; it now checks ASU + CRON_SECRET.
      // CRON_SECRET stays configured via baseEnv, so only the ASU vars are missing.
      expect.arrayContaining(['ASU_API_BASE_URL', 'ASU_API_TOKEN'])
    );
    expect(data.checks.email.missing).toEqual(
      expect.arrayContaining(['EMAIL binding', 'NOTIFICATION_FROM_EMAIL'])
    );
  });
});
