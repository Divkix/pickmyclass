import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';

const { mockGetSessionIdentity, mockQueryOne, mockCallFunction, mockCaptureServerEvent } =
  vi.hoisted(() => ({
    mockGetSessionIdentity: vi.fn(),
    mockQueryOne: vi.fn(),
    mockCallFunction: vi.fn(),
    mockCaptureServerEvent: vi.fn().mockResolvedValue(undefined),
  }));

vi.mock('@/lib/auth/clerk-session', () => ({
  getSessionIdentity: mockGetSessionIdentity,
}));

vi.mock('@/lib/db/client', () => ({
  queryOne: mockQueryOne,
  callFunction: mockCallFunction,
  query: vi.fn(),
  queryScalar: vi.fn(),
  execute: vi.fn(),
  callFunctionScalar: vi.fn(),
  getClient: vi.fn(),
}));

vi.mock('@/lib/posthog-server', () => ({
  captureServerEvent: mockCaptureServerEvent,
}));

import { GET, POST } from '@/app/api/user/onboarding/route';

const user = { userId: 'user-123', clerkUserId: 'clerk_123', sessionId: 'sess_123' };

function get(url: string): Request {
  return new Request(url);
}

function post(url: string): Request {
  return new Request(url, { method: 'POST' });
}

async function json(response: Response) {
  // SAFETY: test helper parses JSON response; shape asserted per test case via property access
  return response.json() as Promise<Record<string, unknown>>;
}

describe('/api/user/onboarding', () => {
  let errorSpy: { mockRestore: () => void };

  beforeEach(() => {
    vi.clearAllMocks();
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockGetSessionIdentity.mockResolvedValue(user);
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  describe('GET', () => {
    it('reports a pending state for a new user with no onboarding timestamps', async () => {
      mockQueryOne.mockResolvedValue({
        onboarding_completed_at: null,
        onboarding_skipped_at: null,
      });

      const response = await GET(get('https://pickmyclass.app/api/user/onboarding'));
      const data = await json(response);

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.onboarding_completed_at).toBeNull();
      expect(data.onboarding_skipped_at).toBeNull();
      expect(data.needs_onboarding).toBe(true);
      expect(mockQueryOne).toHaveBeenCalledTimes(1);
      expect(mockQueryOne).toHaveBeenCalledWith(
        'SELECT onboarding_completed_at, onboarding_skipped_at FROM user_profiles WHERE user_id = $1',
        ['user-123']
      );
      expect(mockCaptureServerEvent).not.toHaveBeenCalled();
    });

    it('falls back to not-needed when the profile row is missing', async () => {
      mockQueryOne.mockResolvedValue(null);

      const response = await GET(get('https://pickmyclass.app/api/user/onboarding'));
      const data = await json(response);

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.onboarding_completed_at).toBeNull();
      expect(data.onboarding_skipped_at).toBeNull();
      expect(data.needs_onboarding).toBe(false);
    });

    it('rejects unauthenticated requests', async () => {
      mockGetSessionIdentity.mockResolvedValueOnce(null);

      const response = await GET(get('https://pickmyclass.app/api/user/onboarding'));
      const data = await json(response);

      expect(response.status).toBe(401);
      expect(data.success).toBe(false);
      expect(data.error).toBe('Unauthorized');
      expect(mockQueryOne).not.toHaveBeenCalled();
    });

    it('returns 500 when the profile read fails', async () => {
      mockQueryOne.mockRejectedValue(new Error('read failed'));

      const response = await GET(get('https://pickmyclass.app/api/user/onboarding'));
      const data = await json(response);

      expect(response.status).toBe(500);
      expect(data.success).toBe(false);
      expect(data.error).toBe('Failed to load onboarding state');
    });
  });

  describe('POST (skip)', () => {
    it('skips onboarding via the RPC and captures exactly one analytics event', async () => {
      mockCallFunction.mockResolvedValue([
        {
          onboarding_completed_at: null,
          onboarding_skipped_at: '2026-07-11T12:00:00Z',
        },
      ]);

      const response = await POST(post('https://pickmyclass.app/api/user/onboarding'));
      const data = await json(response);

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(mockCallFunction).toHaveBeenCalledTimes(1);
      expect(mockCallFunction).toHaveBeenCalledWith('skip_onboarding', ['user-123']);
      expect(data.onboarding_completed_at).toBeNull();
      expect(data.onboarding_skipped_at).toBe('2026-07-11T12:00:00Z');
      expect(data.needs_onboarding).toBe(false);
      expect(mockCaptureServerEvent).toHaveBeenCalledTimes(1);
      expect(mockCaptureServerEvent).toHaveBeenCalledWith({
        distinctId: 'user-123',
        event: 'onboarding_skipped',
      });
      expect(mockCaptureServerEvent.mock.invocationCallOrder[0]).toBeGreaterThan(
        mockCallFunction.mock.invocationCallOrder[0]
      );
    });

    it('returns 500 when the skip RPC produces no rows and fires no analytics', async () => {
      mockCallFunction.mockResolvedValue([]);

      const response = await POST(post('https://pickmyclass.app/api/user/onboarding'));
      const data = await json(response);

      expect(response.status).toBe(500);
      expect(data.success).toBe(false);
      expect(data.error).toBe('Failed to skip onboarding');
      expect(mockCaptureServerEvent).not.toHaveBeenCalled();
    });

    it('returns 500 when the skip RPC fails and fires no analytics', async () => {
      mockCallFunction.mockRejectedValue(new Error('rpc failed'));

      const response = await POST(post('https://pickmyclass.app/api/user/onboarding'));
      const data = await json(response);

      expect(response.status).toBe(500);
      expect(data.success).toBe(false);
      expect(data.error).toBe('Failed to skip onboarding');
      expect(mockCaptureServerEvent).not.toHaveBeenCalled();
    });

    it('rejects unauthenticated requests without touching the DB or analytics', async () => {
      mockGetSessionIdentity.mockResolvedValueOnce(null);

      const response = await POST(post('https://pickmyclass.app/api/user/onboarding'));
      const data = await json(response);

      expect(response.status).toBe(401);
      expect(data.success).toBe(false);
      expect(data.error).toBe('Unauthorized');
      expect(mockCallFunction).not.toHaveBeenCalled();
      expect(mockCaptureServerEvent).not.toHaveBeenCalled();
    });
  });
});
