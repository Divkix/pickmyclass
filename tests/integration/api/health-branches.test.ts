import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { z } from 'zod';

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

  const env = { ...baseEnv, ...options.envOverrides };

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
    fetchClassFromASU,
    getDbFromEnv,
    dbProbe,
  };
}

function request(auth = 'Bearer test-cron-secret') {
  return new NextRequest('https://pickmyclass.app/api/monitoring/health', {
    headers: auth ? { authorization: auth } : {},
  });
}

const healthCheck = z.object({
  status: z.string().optional(),
  error: z.string().optional(),
  configured: z.boolean().optional(),
  missing_vars: z.array(z.string()).optional(),
  missing: z.array(z.string()).optional(),
});

const healthResponse = z.object({
  status: z.string(),
  checks: z.record(z.string(), healthCheck),
});

const livenessResponse = z.object({ status: z.string() });

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
    const data = livenessResponse.parse(await response.json());

    expect(response.status).toBe(200);
    expect(data.status).toBe('ok');
    expect(getDbFromEnv).not.toHaveBeenCalled();
    expect(dbProbe).not.toHaveBeenCalled();
  });

  it('reports healthy detailed checks', async () => {
    vi.stubEnv('CRON_SECRET', '');
    const { GET } = await loadHealthRoute();

    const response = await GET(request());

    const data = healthResponse.parse(await response.json());

    expect(response.status).toBe(200);
    expect(data.status).toBe('healthy');
    expect(data.checks.database.status).toBe('healthy');
    expect(data.checks.asu_api.status).toBe('healthy');
    expect(data.checks.configuration.status).toBe('healthy');
    expect(data.checks.email).toEqual({ status: 'healthy', configured: true });
    expect(data.checks.cron_lock).toBeUndefined();
  });

  it('reports degraded checks when database and ASU checks fail', async () => {
    const { GET } = await loadHealthRoute({
      dbResult: { error: { message: 'database rejected query' } },
      asuError: new Error('ASU unavailable'),
    });

    const response = await GET(request());

    const data = healthResponse.parse(await response.json());

    expect(response.status).toBe(503);
    expect(data.status).toBe('degraded');
    expect(data.checks.database).toMatchObject({
      status: 'unhealthy',
      error: 'database rejected query',
    });
    expect(data.checks.asu_api).toMatchObject({ status: 'unhealthy', error: 'ASU unavailable' });
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
      },
    });

    const response = await GET(request());

    const data = healthResponse.parse(await response.json());

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
