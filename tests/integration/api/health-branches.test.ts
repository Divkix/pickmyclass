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

  const dbProbe = vi.fn(async () => {
    if (options.dbThrows) {
      throw new Error('service unavailable');
    }
    if (options.dbResult?.error) {
      throw new Error(options.dbResult.error.message);
    }
    return [{ id: 'probe-row' }];
  });
  const getDbFromEnv = vi.fn(() => ({
    select: () => ({ from: () => ({ limit: dbProbe }) }),
  }));
  vi.doMock('@/lib/db', () => ({ getDbFromEnv }));

  const mod = await import('@/app/api/monitoring/health/route');
  return {
    GET: mod.GET,
    createCronLockClient,
    doBinding,
    fetchClassFromASU,
    getDbFromEnv,
    dbProbe,
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
    vi.doUnmock('@/lib/db');
  });

  it('returns a cheap liveness probe without auth', async () => {
    const { GET, getDbFromEnv, dbProbe } = await loadHealthRoute();

    const response = await GET(request(''));
    const data = (await response.json()) as { status: string };

    expect(response.status).toBe(200);
    expect(data.status).toBe('ok');
    expect(getDbFromEnv).not.toHaveBeenCalled();
    expect(dbProbe).not.toHaveBeenCalled();
  });

  it('reports healthy detailed checks with a configured cron lock durable object', async () => {
    vi.stubEnv('CRON_SECRET', '');
    const { GET, createCronLockClient, doBinding, lockStatus } = await loadHealthRoute();

    const response = await GET(request());
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
    const data = (await response.json()) as {
      checks: {
        cron_lock: { lock_acquired_at: string | null; expires_at: string | null };
      };
    };

    expect(data.checks.cron_lock.lock_acquired_at).toBe('1970-01-01T00:00:00.000Z');
    expect(data.checks.cron_lock.expires_at).toBe('1970-01-01T00:00:00.001Z');
  });

  it('caches detailed health checks for repeated authenticated requests', async () => {
    const { GET, dbProbe } = await loadHealthRoute();

    await GET(request());
    await GET(request());

    expect(dbProbe).toHaveBeenCalledTimes(1);
  });

  it('reports degraded checks when database, ASU, and cron lock checks fail', async () => {
    const { GET } = await loadHealthRoute({
      dbResult: { error: { message: 'database rejected query' } },
      asuError: new Error('ASU unavailable'),
      doThrows: true,
    });

    const response = await GET(request());
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
      expect.arrayContaining(['ASU_API_BASE_URL', 'ASU_API_TOKEN'])
    );
    expect(data.checks.email.missing).toEqual(
      expect.arrayContaining(['EMAIL binding', 'NOTIFICATION_FROM_EMAIL'])
    );
  });
});
