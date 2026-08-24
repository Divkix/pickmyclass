import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';

// Response type for the cron route
interface MaintenanceResponse {
  success?: boolean;
  error?: string;
  duration_ms?: number;
}

// Mock the data-plane seam so we can assert the expiry-sweep function is invoked.
// callFunctionScalar replaces the old service .rpc('expire_stale_notifications').
const mockCallFunctionScalar = vi.hoisted(() => vi.fn());
vi.mock('@/lib/db/client', () => ({
  callFunctionScalar: mockCallFunctionScalar,
  query: vi.fn(),
  queryOne: vi.fn(),
  queryScalar: vi.fn(),
  execute: vi.fn(),
  callFunction: vi.fn(),
  getClient: vi.fn(),
  setConnectionStringGetter: vi.fn(),
}));

// Mock the past-term watch sweep so we can assert it's called with the right term codes.
const mockDeletePastTermWatches = vi.hoisted(() => vi.fn());
vi.mock('@/lib/db/queries', () => ({
  deletePastTermWatches: mockDeletePastTermWatches,
}));

vi.mock('cloudflare:workers', () => ({
  env: { CRON_SECRET: 'test-cron-secret' },
}));

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
async function parseResponse(response: Response): Promise<MaintenanceResponse> {
  // SAFETY: response.json() returns MaintenanceResponse shape from cron route — controlled API response
  return (await response.json()) as MaintenanceResponse;
}

describe('GET /api/cron/update-disposable-domains', () => {
  let GET: (request: NextRequest) => Promise<Response>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockCallFunctionScalar.mockResolvedValue(0);
    // Dynamic import is the test seam: the route module must load only after the
    // hoisted cloudflare:workers / db mocks above are registered.
    const mod = await import('@/app/api/cron/update-disposable-domains/route');

    GET = mod.GET;
  });

  afterEach(() => {
    // SAFETY: process.env requires Record cast to delete dynamic CRON_SECRET key — no typed delete alternative
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
      // process.env holds a different secret — only the env-binding value should work.
      process.env.CRON_SECRET = 'process-env-secret';

      const response = await GET(createRequest('test-cron-secret'));

      expect(response.status).toBe(200);
    });
  });

  describe('notification expiry sweep', () => {
    it('expires stale notification dedup slots and reports success', async () => {
      mockCallFunctionScalar.mockResolvedValue(7);

      const response = await GET(createRequest('test-cron-secret'));
      const data = await parseResponse(response);

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(mockCallFunctionScalar).toHaveBeenCalledWith('expire_stale_notifications');
    });

    it('still completes the daily job when the expiry sweep throws', async () => {
      mockCallFunctionScalar.mockRejectedValue(new Error('db down'));

      const response = await GET(createRequest('test-cron-secret'));
      const data = await parseResponse(response);

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
    });

    it('still completes the daily job when the expiry sweep returns an RPC error', async () => {
      mockCallFunctionScalar.mockResolvedValue(null);

      const response = await GET(createRequest('test-cron-secret'));

      expect(response.status).toBe(200);
      expect(mockCallFunctionScalar).toHaveBeenCalledWith('expire_stale_notifications');
    });
  });

  describe('past-term watch sweep', () => {
    it('hard-deletes class_watches for terms that have ended', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-09-01T19:00:00Z'));
      try {
        mockDeletePastTermWatches.mockResolvedValue(3);

        const response = await GET(createRequest('test-cron-secret'));
        expect(response.status).toBe(200);

        expect(mockDeletePastTermWatches).toHaveBeenCalledTimes(1);
        // SAFETY: mock.calls[0] is controlled test mock returning [string[]] of term codes
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
