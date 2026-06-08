import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';

type HealthRouteOptions = {
  envOverrides?: Record<string, unknown>;
  dbResult?: { error: { message: string } | null };
  dbThrows?: boolean;
  asuError?: Error;
  doThrows?: boolean;
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

  const lockFetch = vi.fn(async () =>
    Response.json({
      locked: true,
      lockHolder: 'cron-run',
      lockAcquiredAt: Date.now() - 1000,
      timeHeldMs: 1000,
      expiresAt: Date.now() + 1000,
    })
  );
  const doBinding = {
    idFromName: vi.fn(() => 'lock-id'),
    get: vi.fn(() => ({
      fetch: options.doThrows ? vi.fn(async () => Promise.reject(new Error('DO down'))) : lockFetch,
    })),
  };
  const env = {
    ...baseEnv,
    PICKMYCLASS_CRON_LOCK_DO: doBinding,
    ...options.envOverrides,
  };

  vi.doMock('cloudflare:workers', () => ({ env }));

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

  const limit = vi.fn(async () => options.dbResult ?? { error: null });
  const getServiceClient = vi.fn(() => {
    if (options.dbThrows) {
      throw new Error('service unavailable');
    }
    return {
      from: vi.fn(() => ({
        select: vi.fn(() => ({ limit })),
      })),
    };
  });
  vi.doMock('@/lib/supabase/service', () => ({
    getServiceClient,
  }));

  const mod = await import('@/app/api/monitoring/health/route');
  return { GET: mod.GET, doBinding, fetchClassFromASU, getServiceClient, limit, lockFetch };
}

function request(auth = 'Bearer test-cron-secret') {
  return new NextRequest('https://pickmyclass.app/api/monitoring/health', {
    headers: auth ? { authorization: auth } : {},
  });
}

describe('GET /api/monitoring/health branch coverage', () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock('cloudflare:workers');
    vi.doUnmock('@/lib/asu/api');
    vi.doUnmock('@/lib/supabase/service');
  });

  it('returns a cheap liveness probe without auth', async () => {
    const { GET, getServiceClient } = await loadHealthRoute();

    const response = await GET(request(''));
    const data = (await response.json()) as { status: string };

    expect(response.status).toBe(200);
    expect(data.status).toBe('ok');
    expect(getServiceClient).not.toHaveBeenCalled();
  });

  it('reports healthy detailed checks with a configured cron lock durable object', async () => {
    const { GET, doBinding, lockFetch } = await loadHealthRoute();

    const response = await GET(request());
    const data = (await response.json()) as {
      status: string;
      checks: {
        cron_lock: { status: string; locked: boolean; lock_holder: string };
      };
    };

    expect(response.status).toBe(200);
    expect(data.status).toBe('healthy');
    expect(data.checks.cron_lock).toMatchObject({
      status: 'healthy',
      locked: true,
      lock_holder: 'cron-run',
    });
    expect(doBinding.idFromName).toHaveBeenCalledWith('pickmyclass-cron-lock');
    expect(lockFetch).toHaveBeenCalledWith('http://do/status');
  });

  it('caches detailed health checks for repeated authenticated requests', async () => {
    const { GET, getServiceClient } = await loadHealthRoute();

    await GET(request());
    await GET(request());

    expect(getServiceClient).toHaveBeenCalledTimes(1);
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
      expect.arrayContaining([
        'ASU_API_BASE_URL',
        'ASU_API_TOKEN',
        'SUPABASE_SEND_EMAIL_HOOK_SECRET',
      ])
    );
    expect(data.checks.email.missing).toEqual(
      expect.arrayContaining(['EMAIL binding', 'NOTIFICATION_FROM_EMAIL'])
    );
  });
});
