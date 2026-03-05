import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

vi.mock('cloudflare:workers', () => ({
  env: {
    DISPOSABLE_DOMAINS_KV: {
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

// Helper to parse response
async function parseResponse(response: Response): Promise<SyncResponse> {
  return (await response.json()) as SyncResponse;
}

describe('GET /api/cron/update-disposable-domains', () => {
  let GET: (request: NextRequest) => Promise<Response>;

  beforeEach(async () => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = 'test-cron-secret';
    mockKvPut.mockResolvedValue(undefined);

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
  });
});
