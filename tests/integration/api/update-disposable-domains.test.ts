import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';

// Response type for the cron route
interface SyncResponse {
  success?: boolean;
  error?: string;
  domainCount?: number;
  duration_ms?: number;
}

// Mock cloudflare:workers for env import
// vi.hoisted ensures mockKvPut is initialized before the hoisted vi.mock factory runs
const mockKvPut = vi.hoisted(() => vi.fn());

// Mock the Supabase service client so we can assert the expiry-sweep RPC is invoked.
const mockRpc = vi.hoisted(() => vi.fn());
vi.mock('@/lib/supabase/service', () => ({
  getServiceClient: () => ({ rpc: mockRpc }),
}));

// Mock the past-term watch sweep so we can assert it's called with the right term codes.
const mockDeletePastTermWatches = vi.hoisted(() => vi.fn());
vi.mock('@/lib/db/queries', () => ({
  deletePastTermWatches: mockDeletePastTermWatches,
}));

vi.mock('cloudflare:workers', () => ({
  env: {
    CRON_SECRET: 'test-cron-secret',
    PICKMYCLASS_DISPOSABLE_DOMAINS: {
      put: mockKvPut,
      get: vi.fn(),
      delete: vi.fn(),
      list: vi.fn(),
      getWithMetadata: vi.fn(),
    },
  },
}));

// Save original fetch
const originalFetch = globalThis.fetch;

// Helper to create NextRequest with auth
function createRequest(cronSecret?: string): NextRequest {
  // eslint-disable-next-line anti-slop/no-known-value-widening -- SAFETY: headers needs index signature for dynamic Authorization
  const headers: Record<string, string> = {
    'User-Agent': 'Cloudflare-Workers-Cron',
  };
  if (cronSecret) {
    headers.Authorization = `Bearer ${cronSecret}`;
  }
  return new NextRequest('http://localhost/api/cron/update-disposable-domains', {
    method: 'GET',
    headers,
  });
}
async function parseResponse(response: Response): Promise<SyncResponse> {
  return (await response.json()) as SyncResponse;
}

describe('GET /api/cron/update-disposable-domains', () => {
  let GET: (request: NextRequest) => Promise<Response>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockKvPut.mockResolvedValue(undefined);
    mockRpc.mockResolvedValue({ data: 0, error: null });
    mockDeletePastTermWatches.mockResolvedValue(0);

    const mod = await import('@/app/api/cron/update-disposable-domains/route');
    GET = mod.GET;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    delete (process.env as Record<string, string | undefined>).CRON_SECRET;
  });

  describe('authentication', () => {
    it('should return 401 when Authorization header is missing', async () => {
      const request = createRequest();
      const response = await GET(request);

      expect(response.status).toBe(401);
    });

    it('should return 401 when CRON_SECRET is invalid', async () => {
      const request = createRequest('wrong-secret');
      const response = await GET(request);

      expect(response.status).toBe(401);
    });

    it('reads CRON_SECRET from the env binding, not process.env', async () => {
      const domains = Array.from({ length: 1500 }, (_, i) => `domain${i}.com`);
      globalThis.fetch = vi
        .fn()
        .mockResolvedValueOnce({ ok: true, text: () => Promise.resolve(domains.join('\n')) });
      // process.env holds a different secret — only the env-binding value should work.
      process.env.CRON_SECRET = 'process-env-secret';

      const response = await GET(createRequest('test-cron-secret'));

      expect(response.status).toBe(200);
    });
  });

  describe('fetch failures', () => {
    it('should return 502 when blocklist fetch fails', async () => {
      globalThis.fetch = vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      const request = createRequest('test-cron-secret');
      const response = await GET(request);

      expect(response.status).toBe(502);
    });

    it('still runs the notification-expiry sweeps when the blocklist fetch fails', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-09-01T19:00:00Z'));
      try {
        globalThis.fetch = vi.fn().mockResolvedValueOnce({
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
        });
        mockRpc.mockResolvedValue({ data: 7, error: null });

        const response = await GET(createRequest('test-cron-secret'));

        expect(response.status).toBe(502);
        expect(mockRpc).toHaveBeenCalledWith('expire_stale_notifications');
        expect(mockDeletePastTermWatches).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it('should return 502 when fetch throws network error', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

      const request = createRequest('test-cron-secret');
      const response = await GET(request);

      expect(response.status).toBe(500);
    });
  });

  describe('successful sync', () => {
    it('should store domains as single JSON blob in KV', async () => {
      const domains = Array.from({ length: 1500 }, (_, i) => `domain${i}.com`);
      const blocklist = domains.join('\n');

      globalThis.fetch = vi
        .fn()
        .mockResolvedValueOnce({ ok: true, text: () => Promise.resolve(blocklist) });

      const request = createRequest('test-cron-secret');
      const response = await GET(request);
      const data = await parseResponse(response);

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.domainCount).toBe(1500);
      expect(mockKvPut).toHaveBeenCalledTimes(1);
      expect(mockKvPut).toHaveBeenCalledWith('disposable-domains', expect.any(String));

      // Verify the stored JSON is valid
      const storedDomains = JSON.parse(mockKvPut.mock.calls[0][1] as string) as string[];
      expect(storedDomains).toHaveLength(1500);
      expect(storedDomains[0]).toBe('domain0.com');
    });

    it('should invoke the expire_stale_notifications sweep after a successful sync', async () => {
      const domains = Array.from({ length: 1500 }, (_, i) => `domain${i}.com`);
      const blocklist = domains.join('\n');

      globalThis.fetch = vi
        .fn()
        .mockResolvedValueOnce({ ok: true, text: () => Promise.resolve(blocklist) });
      mockRpc.mockResolvedValue({ data: 7, error: null });

      const request = createRequest('test-cron-secret');
      const response = await GET(request);

      expect(response.status).toBe(200);
      expect(mockRpc).toHaveBeenCalledWith('expire_stale_notifications');
    });

    it('still completes the blocklist sync when the expiry sweep throws', async () => {
      const domains = Array.from({ length: 1500 }, (_, i) => `domain${i}.com`);
      globalThis.fetch = vi
        .fn()
        .mockResolvedValueOnce({ ok: true, text: () => Promise.resolve(domains.join('\n')) });
      mockRpc.mockRejectedValue(new Error('db down'));

      const response = await GET(createRequest('test-cron-secret'));
      const data = await parseResponse(response);

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(mockKvPut).toHaveBeenCalledTimes(1);
      expect(mockKvPut).toHaveBeenCalledWith('disposable-domains', expect.any(String));
    });

    it('still completes the blocklist sync when the expiry sweep returns an RPC error', async () => {
      const domains = Array.from({ length: 1500 }, (_, i) => `domain${i}.com`);
      globalThis.fetch = vi
        .fn()
        .mockResolvedValueOnce({ ok: true, text: () => Promise.resolve(domains.join('\n')) });
      mockRpc.mockResolvedValue({ data: null, error: { message: 'rpc failed' } });

      const response = await GET(createRequest('test-cron-secret'));

      expect(response.status).toBe(200);
      expect(mockKvPut).toHaveBeenCalledTimes(1);
    });

    it('should normalize domains to lowercase and filter empty lines', async () => {
      const domains = Array.from({ length: 1100 }, (_, i) => `Domain${i}.COM`);
      const blocklist = `\n  ${domains.join('\n  ')}\n\n  \n`;

      globalThis.fetch = vi
        .fn()
        .mockResolvedValueOnce({ ok: true, text: () => Promise.resolve(blocklist) });

      const request = createRequest('test-cron-secret');
      const response = await GET(request);
      const data = await parseResponse(response);

      expect(response.status).toBe(200);
      expect(data.domainCount).toBe(1100);

      const storedDomains = JSON.parse(mockKvPut.mock.calls[0][1] as string) as string[];
      expect(storedDomains[0]).toBe('domain0.com');
    });

    it('should skip comment lines starting with #', async () => {
      const lines = ['# This is a comment', ...Array.from({ length: 1100 }, (_, i) => `d${i}.com`)];
      const blocklist = lines.join('\n');

      globalThis.fetch = vi
        .fn()
        .mockResolvedValueOnce({ ok: true, text: () => Promise.resolve(blocklist) });

      const request = createRequest('test-cron-secret');
      const response = await GET(request);
      const data = await parseResponse(response);

      expect(response.status).toBe(200);
      expect(data.domainCount).toBe(1100);
    });
  });

  describe('sanity check', () => {
    it('should return 502 when domain count is below minimum', async () => {
      const blocklist = 'only-one.com\ntwo.com\nthree.com';

      globalThis.fetch = vi
        .fn()
        .mockResolvedValueOnce({ ok: true, text: () => Promise.resolve(blocklist) });

      const request = createRequest('test-cron-secret');
      const response = await GET(request);
      const data = await parseResponse(response);

      expect(response.status).toBe(502);
      expect(data.error).toContain('Sanity check');
      expect(mockKvPut).not.toHaveBeenCalled();
    });

    it('should return 502 for empty blocklist', async () => {
      globalThis.fetch = vi
        .fn()
        .mockResolvedValueOnce({ ok: true, text: () => Promise.resolve('') });

      const request = createRequest('test-cron-secret');
      const response = await GET(request);

      expect(response.status).toBe(502);
      expect(mockKvPut).not.toHaveBeenCalled();
    });

    it('still runs the notification-expiry sweeps when the sanity check fails', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-09-01T19:00:00Z'));
      try {
        globalThis.fetch = vi.fn().mockResolvedValueOnce({
          ok: true,
          text: () => Promise.resolve('only-one.com\ntwo.com\nthree.com'),
        });

        const response = await GET(createRequest('test-cron-secret'));

        expect(response.status).toBe(502);
        expect(mockRpc).toHaveBeenCalledWith('expire_stale_notifications');
        expect(mockDeletePastTermWatches).toHaveBeenCalledTimes(1);
        expect(mockKvPut).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('past-term watch sweep', () => {
    function mockBlocklistFetch() {
      const domains = Array.from({ length: 1500 }, (_, i) => `domain${i}.com`);
      globalThis.fetch = vi
        .fn()
        .mockResolvedValueOnce({ ok: true, text: () => Promise.resolve(domains.join('\n')) });
    }

    it('hard-deletes class_watches for terms that have ended', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-09-01T19:00:00Z'));
      try {
        mockBlocklistFetch();
        mockDeletePastTermWatches.mockResolvedValue(3);

        const response = await GET(createRequest('test-cron-secret'));
        expect(response.status).toBe(200);

        expect(mockDeletePastTermWatches).toHaveBeenCalledTimes(1);
        const [codes] = mockDeletePastTermWatches.mock.calls[0] as [string[]];
        expect(codes).toContain('2261'); // Spring 2026 ended 2026-05-09
        expect(codes).toContain('2264'); // Summer 2026 ended 2026-08-14
        expect(codes).not.toContain('2267'); // Fall 2026 still in session
      } finally {
        vi.useRealTimers();
      }
    });

    it('skips the delete when no term has ended', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2025-01-01T19:00:00Z'));
      try {
        mockBlocklistFetch();

        const response = await GET(createRequest('test-cron-secret'));
        expect(response.status).toBe(200);
        expect(mockDeletePastTermWatches).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });

    it('does not fail the daily job when the sweep errors', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-09-01T19:00:00Z'));
      try {
        mockBlocklistFetch();
        mockDeletePastTermWatches.mockRejectedValue(new Error('db down'));

        const response = await GET(createRequest('test-cron-secret'));
        expect(response.status).toBe(200);
        expect(mockDeletePastTermWatches).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
