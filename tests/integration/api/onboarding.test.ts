// @ts-nocheck — skipped Clerk migration placeholder; rewrite to mock clerk-session (tracked in issue #351)
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';

const { mockCreateClient, mockGetUser, mockQueryOne, mockCallFunction, mockCaptureServerEvent } =
  vi.hoisted(() => ({
    mockCreateClient: vi.fn(),
    mockGetUser: vi.fn(),
    mockQueryOne: vi.fn(),
    mockCallFunction: vi.fn(),
    mockCaptureServerEvent: vi.fn().mockResolvedValue(undefined),
  }));

vi.mock('@/lib/posthog-server', () => ({
  captureServerEvent: mockCaptureServerEvent,
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: mockCreateClient,
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

import { GET, POST } from '@/app/api/user/onboarding/route';

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

const user = { id: 'user-123', email: 'student@example.com' };

function createServerClient() {
  return {
    auth: { getUser: mockGetUser },
  };
}

async function json(response: Response) {
  // SAFETY: test helper parses JSON response; shape asserted per test case via property access
  return response.json() as Promise<Record<string, JsonValue>>;
}

describe.skip('/api/user/onboarding', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockCreateClient.mockResolvedValue(createServerClient());
    mockGetUser.mockResolvedValue({ data: { user }, error: null });
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
      mockQueryOne.mockResolvedValue({
        onboarding_completed_at: null,
        onboarding_skipped_at: null,
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
      mockQueryOne.mockResolvedValue({
        onboarding_completed_at: null,
        onboarding_skipped_at: '2026-07-11T00:00:00Z',
      });

      const response = await GET();
      const data = await json(response);

      expect(response.status).toBe(200);
      expect(data.needs_onboarding).toBe(false);
      expect(data.onboarding_skipped_at).toBe('2026-07-11T00:00:00Z');
    });

    it('treats existing (completed) users as not needing onboarding', async () => {
      mockQueryOne.mockResolvedValue({
        onboarding_completed_at: '2026-07-10T00:00:00Z',
        onboarding_skipped_at: null,
      });

      const response = await GET();
      const data = await json(response);

      expect(response.status).toBe(200);
      expect(data.needs_onboarding).toBe(false);
    });

    it('defaults to not-needed when the profile row is missing', async () => {
      mockQueryOne.mockResolvedValue(null);

      const response = await GET();
      const data = await json(response);

      expect(response.status).toBe(200);
      expect(data.needs_onboarding).toBe(false);
    });

    it('returns 500 when the profile read fails', async () => {
      mockQueryOne.mockRejectedValue(new Error('boom'));

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
      expect(mockCallFunction).not.toHaveBeenCalled();
    });

    it('sets onboarding_skipped_at via the skip_onboarding RPC and returns the new state', async () => {
      mockCallFunction.mockResolvedValue([
        {
          onboarding_completed_at: null,
          onboarding_skipped_at: '2026-07-11T12:00:00Z',
        },
      ]);

      const response = await POST();
      const data = await json(response);

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(mockCallFunction).toHaveBeenCalledWith('skip_onboarding', ['user-123']);
      expect(data.onboarding_skipped_at).toBe('2026-07-11T12:00:00Z');
      expect(data.onboarding_completed_at).toBeNull();
      expect(data.needs_onboarding).toBe(false);
      expect(mockCaptureServerEvent).toHaveBeenCalledWith({
        distinctId: user.id,
        event: 'onboarding_skipped',
      });
      expect(mockCaptureServerEvent.mock.invocationCallOrder[0]).toBeGreaterThan(
        mockCallFunction.mock.invocationCallOrder[0]
      );
    });

    it('returns 500 when the RPC fails', async () => {
      mockCallFunction.mockRejectedValue(new Error('rpc failed'));

      const response = await POST();
      const data = await json(response);

      expect(response.status).toBe(500);
      expect(data.error).toBe('Failed to skip onboarding');
    });
  });
});
