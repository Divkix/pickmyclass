import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';

const {
  mockCreateClient,
  mockGetUser,
  mockFrom,
  mockSelect,
  mockEq,
  mockMaybeSingle,
  mockRpc,
  mockCaptureServerEvent,
} = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
  mockGetUser: vi.fn(),
  mockFrom: vi.fn(),
  mockSelect: vi.fn(),
  mockEq: vi.fn(),
  mockMaybeSingle: vi.fn(),
  mockRpc: vi.fn(),
  mockCaptureServerEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/posthog-server', () => ({
  captureServerEvent: mockCaptureServerEvent,
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: mockCreateClient,
}));

import { GET, POST } from '@/app/api/user/onboarding/route';

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

const user = { id: 'user-123', email: 'student@example.com' };

function createServerClient() {
  return {
    auth: { getUser: mockGetUser },
    from: mockFrom,
    rpc: mockRpc,
  };
}

async function json(response: Response) {
  // SAFETY: test helper parses JSON response; shape asserted per test case via property access
  return response.json() as Promise<Record<string, JsonValue>>;
}

describe('/api/user/onboarding', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockCreateClient.mockResolvedValue(createServerClient());
    mockGetUser.mockResolvedValue({ data: { user }, error: null });
    mockFrom.mockReturnValue({ select: mockSelect });
    mockSelect.mockReturnValue({ eq: mockEq });
    mockEq.mockReturnValue({ maybeSingle: mockMaybeSingle });
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  describe('GET', () => {
    it('rejects unauthenticated requests', async () => {
      mockGetUser.mockResolvedValueOnce({ data: { user: null }, error: { message: 'no session' } });

      const response = await GET();
      const data = await json(response);

      expect(response.status).toBe(401);
      expect(data.error).toBe('Unauthorized');
    });

    it('exposes needs_onboarding=true for a new user with no onboarding timestamps', async () => {
      mockMaybeSingle.mockResolvedValue({
        data: { onboarding_completed_at: null, onboarding_skipped_at: null },
        error: null,
      });

      const response = await GET();
      const data = await json(response);

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.onboarding_completed_at).toBeNull();
      expect(data.onboarding_skipped_at).toBeNull();
      expect(data.needs_onboarding).toBe(true);
    });

    it('exposes needs_onboarding=false after the user skips', async () => {
      mockMaybeSingle.mockResolvedValue({
        data: {
          onboarding_completed_at: null,
          onboarding_skipped_at: '2026-07-11T00:00:00Z',
        },
        error: null,
      });

      const response = await GET();
      const data = await json(response);

      expect(response.status).toBe(200);
      expect(data.needs_onboarding).toBe(false);
      expect(data.onboarding_skipped_at).toBe('2026-07-11T00:00:00Z');
    });

    it('treats existing (completed) users as not needing onboarding', async () => {
      mockMaybeSingle.mockResolvedValue({
        data: {
          onboarding_completed_at: '2026-07-10T00:00:00Z',
          onboarding_skipped_at: null,
        },
        error: null,
      });

      const response = await GET();
      const data = await json(response);

      expect(response.status).toBe(200);
      expect(data.needs_onboarding).toBe(false);
    });

    it('defaults to not-needed when the profile row is missing', async () => {
      mockMaybeSingle.mockResolvedValue({ data: null, error: null });

      const response = await GET();
      const data = await json(response);

      expect(response.status).toBe(200);
      expect(data.needs_onboarding).toBe(false);
    });

    it('returns 500 when the profile read fails', async () => {
      mockMaybeSingle.mockResolvedValue({ data: null, error: { message: 'boom' } });

      const response = await GET();
      const data = await json(response);

      expect(response.status).toBe(500);
      expect(data.error).toBe('Failed to load onboarding state');
    });
  });

  describe('POST (skip)', () => {
    it('rejects unauthenticated requests', async () => {
      mockGetUser.mockResolvedValueOnce({ data: { user: null }, error: { message: 'no session' } });

      const response = await POST();
      const data = await json(response);

      expect(response.status).toBe(401);
      expect(data.error).toBe('Unauthorized');
      expect(mockRpc).not.toHaveBeenCalled();
    });

    it('sets onboarding_skipped_at via the skip_onboarding RPC and returns the new state', async () => {
      mockRpc.mockResolvedValue({
        data: [
          {
            onboarding_completed_at: null,
            onboarding_skipped_at: '2026-07-11T12:00:00Z',
          },
        ],
        error: null,
      });

      const response = await POST();
      const data = await json(response);

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(mockRpc).toHaveBeenCalledWith('skip_onboarding');
      expect(data.onboarding_skipped_at).toBe('2026-07-11T12:00:00Z');
      expect(data.onboarding_completed_at).toBeNull();
      expect(data.needs_onboarding).toBe(false);
      expect(mockCaptureServerEvent).toHaveBeenCalledWith({
        distinctId: user.id,
        event: 'onboarding_skipped',
      });
      expect(mockCaptureServerEvent.mock.invocationCallOrder[0]).toBeGreaterThan(
        mockRpc.mock.invocationCallOrder[0]
      );
    });

    it('returns 500 when the RPC fails', async () => {
      mockRpc.mockResolvedValue({ data: null, error: { message: 'rpc failed' } });

      const response = await POST();
      const data = await json(response);

      expect(response.status).toBe(500);
      expect(data.error).toBe('Failed to skip onboarding');
    });
  });
});
