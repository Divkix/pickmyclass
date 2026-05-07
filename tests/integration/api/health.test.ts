import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('cloudflare:workers', () => ({
  env: {
    ASU_API_BASE_URL: 'https://example.com/api',
    ASU_API_TOKEN: 'test-token',
    CRON_SECRET: 'test-cron-secret',
    NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
    SUPABASE_SEND_EMAIL_HOOK_SECRET: 'whsec_test',
    EMAIL: { send: vi.fn() },
    NOTIFICATION_FROM_EMAIL: 'notifications@pickmyclass.app',
  },
}));

const MockNotFoundError = vi.hoisted(() => class MockNotFoundError extends Error {});
const mockFetchClassFromASU = vi.hoisted(() => vi.fn());
vi.mock('@/lib/asu/api', () => ({
  fetchClassFromASU: (...args: unknown[]) => mockFetchClassFromASU(...args),
  NotFoundError: MockNotFoundError,
}));

const { mockFrom, mockLimit } = vi.hoisted(() => {
  const mockLimit = vi.fn();
  const mockSelect = vi.fn(() => ({ limit: mockLimit }));
  const mockFrom = vi.fn(() => ({ select: mockSelect }));
  return { mockFrom, mockLimit };
});

vi.mock('@/lib/supabase/service', () => ({
  getServiceClient: vi.fn(() => ({
    from: mockFrom,
  })),
}));

import { GET } from '@/app/api/monitoring/health/route';

function createRequest(authHeader?: string): NextRequest {
  return new NextRequest('http://localhost:3000/api/monitoring/health', {
    method: 'GET',
    headers: authHeader ? { Authorization: authHeader } : {},
  });
}

describe('GET /api/monitoring/health', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    (process.env as Record<string, string | undefined>).CRON_SECRET = undefined;

    mockLimit.mockResolvedValue({ error: null });
    mockFetchClassFromASU.mockRejectedValue(new MockNotFoundError('not found'));
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('uses Cloudflare CRON_SECRET binding for authenticated detailed health checks', async () => {
    const response = await GET(createRequest('Bearer test-cron-secret'));
    const data = (await response.json()) as {
      status: string;
      checks?: {
        database?: unknown;
        asu_api?: unknown;
        configuration?: unknown;
        email?: { status: string; configured: boolean };
      };
    };

    expect(response.status).toBe(200);
    expect(data.status).toBe('healthy');
    expect(data.checks?.database).toBeDefined();
    expect(data.checks?.asu_api).toBeDefined();
    expect(data.checks?.configuration).toBeDefined();
    expect(data.checks?.email).toEqual({ status: 'healthy', configured: true });
  });
});
