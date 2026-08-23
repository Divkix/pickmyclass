/**
 * Focused Clerk-era suite for the onboarding wiring inside /api/class-watches
 * (issue #357). Covers only the three onboarding behaviors owned by
 * lib/onboarding.ts:
 *
 *   1. Successful POST delegates first-watch completion to applyFirstWatchGuard
 *      with the authenticated user id.
 *   2. A first-watch guard failure is non-fatal: the watch is still created and
 *      the rest of the pipeline (analytics) still runs.
 *   3. GET embeds the onboarding state via readOnboardingState, and a failure of
 *      that auxiliary read is isolated: the response stays 200 with the full
 *      watches list and the module's "not needed" projection as fallback.
 *
 * The broad Supabase-era /api/class-watches suite (class-watches.test.ts) is a
 * skipped migration placeholder (#351); general CRUD coverage belongs there, so
 * this file intentionally does not duplicate it.
 */
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
// Any currently selectable term satisfies the real createClassWatchSchema
// refinement regardless of when the suite runs.
import { getSelectableTerms } from '@/lib/asu/terms';
import type { ClassStateRow, ClassWatchRow } from '@/lib/db/types';
import type { OnboardingPayload } from '@/lib/onboarding';
import type { ClassDetails } from '@/lib/types/class';

const {
  mockGetSessionIdentity,
  mockQuery,
  mockQueryOne,
  mockCallFunction,
  mockFetchClassFromASU,
  mockUpsertClassState,
  mockApplyFirstWatchGuard,
  mockCaptureServerEvent,
  AuthError,
  NotFoundError,
} = vi.hoisted(() => {
  class MockAuthError extends Error {}
  class MockNotFoundError extends Error {}
  return {
    mockGetSessionIdentity: vi.fn(),
    mockQuery: vi.fn(),
    mockQueryOne: vi.fn(),
    mockCallFunction: vi.fn(),
    mockFetchClassFromASU: vi.fn(),
    mockUpsertClassState: vi.fn(),
    mockApplyFirstWatchGuard: vi.fn(),
    mockCaptureServerEvent: vi.fn().mockResolvedValue(undefined),
    AuthError: MockAuthError,
    NotFoundError: MockNotFoundError,
  };
});

// Clerk identity seam: withAuth -> requireUser -> getSessionIdentity.
vi.mock('@/lib/auth/clerk-session', () => ({
  getSessionIdentity: mockGetSessionIdentity,
}));

vi.mock('@/lib/db/client', () => ({
  query: mockQuery,
  queryOne: mockQueryOne,
  callFunction: mockCallFunction,
  // Remaining client surface unused by these routes; stubbed for graph completeness.
  queryScalar: vi.fn(),
  execute: vi.fn(),
  callFunctionScalar: vi.fn(),
  getClient: vi.fn(),
}));

vi.mock('@/lib/db/queries', () => ({
  upsertClassState: mockUpsertClassState,
}));

// Keep the real projections AND the real readOnboardingState (its dynamic
// @/lib/db/client import resolves to the mocked queryOne above); only the
// persistence-side first-watch guard is stubbed so tests can assert its
// invocation and rejection.
vi.mock('@/lib/onboarding', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/onboarding')>()),
  applyFirstWatchGuard: mockApplyFirstWatchGuard,
}));

vi.mock('@/lib/asu/api', () => ({
  fetchClassFromASU: mockFetchClassFromASU,
  AuthError,
  NotFoundError,
}));

vi.mock('@/lib/posthog-server', () => ({
  captureServerEvent: mockCaptureServerEvent,
}));

vi.mock('cloudflare:workers', () => ({
  env: {
    ASU_API_BASE_URL: 'https://mock-asu-api.example.com',
    ASU_API_TOKEN: 'mock-token',
  },
}));

import { GET, POST } from '@/app/api/class-watches/route';

const USER_ID = 'user-123';
const identity = {
  userId: USER_ID,
  clerkUserId: 'user_test_clerk_123',
  sessionId: 'sess_test_123',
};

const term = getSelectableTerms()[0].code;

const classDetails: ClassDetails = {
  subject: 'CSE',
  catalog_nbr: '240',
  title: 'Introduction to Programming',
  instructor_name: 'Jane Doe',
  seats_available: 10,
  seats_capacity: 50,
  non_reserved_seats: null,
  location: 'COOR 120',
  meeting_times: 'MWF 9:00-9:50 AM',
};

const createdWatch: ClassWatchRow = {
  id: 'watch-1',
  user_id: USER_ID,
  class_nbr: '12345',
  term,
  subject: 'CSE',
  catalog_nbr: '240',
  created_at: '2026-01-02T00:00:00Z',
};

const watchedWithoutState: ClassWatchRow = {
  id: 'watch-2',
  user_id: USER_ID,
  class_nbr: '54321',
  term,
  subject: 'MAT',
  catalog_nbr: '270',
  created_at: '2026-01-03T00:00:00Z',
};

const matchingClassState: ClassStateRow = {
  id: 'state-1',
  class_nbr: '12345',
  term,
  subject: 'CSE',
  catalog_nbr: '240',
  title: 'Introduction to Programming',
  instructor_name: 'Jane Doe',
  seats_available: 10,
  seats_capacity: 50,
  non_reserved_seats: null,
  location: 'COOR 120',
  meeting_times: 'MWF 9:00-9:50 AM',
  last_checked_at: '2026-01-03T00:00:00Z',
  last_changed_at: '2026-01-03T00:00:00Z',
  consecutive_not_found_count: 0,
};

type ProfileRow = {
  onboarding_completed_at: string | null;
  onboarding_skipped_at: string | null;
};

interface GetBody {
  success?: boolean;
  watches?: Array<ClassWatchRow & { class_state: ClassStateRow | null }>;
  maxWatches?: number;
  onboarding?: OnboardingPayload;
}

interface PostBody {
  success?: boolean;
  watch?: ClassWatchRow;
}

function getRequest(): NextRequest {
  return new NextRequest('http://localhost:3000/api/class-watches');
}

function postRequest(body: { term: string; class_nbr: string }): NextRequest {
  return new NextRequest('http://localhost:3000/api/class-watches', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

// SAFETY: test helper parses mocked route JSON; shapes are the GetBody/PostBody contracts above
async function json<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

describe('/api/class-watches onboarding wiring', () => {
  let watchesRows: ClassWatchRow[];
  let classStateRows: ClassStateRow[];
  let profileRow: ProfileRow;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    mockGetSessionIdentity.mockResolvedValue(identity);

    watchesRows = [];
    classStateRows = [];
    profileRow = { onboarding_completed_at: null, onboarding_skipped_at: null };
    mockQueryOne.mockResolvedValue(profileRow);

    // Dispatch `query` by SQL text: class_watches list vs class_states lookup.
    mockQuery.mockImplementation(async (text: string) => {
      if (text.includes('FROM class_watches WHERE user_id')) return watchesRows;
      if (text.includes('FROM class_states')) return classStateRows;
      return [];
    });

    mockCallFunction.mockResolvedValue([createdWatch]);
    mockFetchClassFromASU.mockResolvedValue(classDetails);
    mockUpsertClassState.mockResolvedValue(undefined);
    mockApplyFirstWatchGuard.mockResolvedValue(undefined);
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  describe('POST /api/class-watches', () => {
    it('creates the watch and marks onboarding complete via the first-watch guard', async () => {
      const response = await POST(postRequest({ term, class_nbr: '12345' }));

      expect(response.status).toBe(201);
      const body = await json<PostBody>(response);
      expect(body.success).toBe(true);
      expect(body.watch).toEqual(createdWatch);

      expect(mockApplyFirstWatchGuard).toHaveBeenCalledTimes(1);
      expect(mockApplyFirstWatchGuard).toHaveBeenCalledWith(USER_ID);
      expect(mockCaptureServerEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          distinctId: USER_ID,
          event: 'class_watch_created',
        })
      );
    });

    it('still returns 201 when the first-watch guard rejects (non-fatal)', async () => {
      mockApplyFirstWatchGuard.mockRejectedValue(new Error('guard update failed'));

      const response = await POST(postRequest({ term, class_nbr: '12345' }));

      expect(response.status).toBe(201);
      const body = await json<PostBody>(response);
      expect(body.success).toBe(true);
      expect(body.watch).toEqual(createdWatch);

      // The pipeline continues past the guard failure: analytics still fires.
      expect(mockCaptureServerEvent).toHaveBeenCalledTimes(1);
      expect(mockCaptureServerEvent).toHaveBeenCalledWith(
        expect.objectContaining({ distinctId: USER_ID })
      );
    });
  });

  describe('GET /api/class-watches', () => {
    it('returns 200 with the full watches list and the onboarding fallback when the auxiliary read fails', async () => {
      watchesRows = [createdWatch, watchedWithoutState];
      classStateRows = [matchingClassState];
      mockQueryOne.mockRejectedValue(new Error('onboarding profile read failed'));

      const response = await GET(getRequest());

      expect(response.status).toBe(200);
      const body = await json<GetBody>(response);
      expect(body.success).toBe(true);

      // Full watches list preserved, joined states intact.
      expect(body.watches).toHaveLength(2);
      expect(body.watches?.[0]).toMatchObject({
        id: 'watch-1',
        class_state: expect.objectContaining({ class_nbr: '12345', term }),
      });
      expect(body.watches?.[1]?.class_state).toBeNull();
      expect(typeof body.maxWatches).toBe('number');

      // The route delegated to the module's real read helper (user_profiles SELECT).
      expect(mockQueryOne).toHaveBeenCalledTimes(1);
      expect(mockQueryOne).toHaveBeenCalledWith(expect.stringContaining('FROM user_profiles'), [
        USER_ID,
      ]);

      // Isolated failure projects toOnboardingState(null): not needed, no timestamps.
      expect(body.onboarding).toEqual({
        onboarding_completed_at: null,
        onboarding_skipped_at: null,
        needs_onboarding: false,
      });
    });

    it('projects the real pending state into the response when the read succeeds', async () => {
      watchesRows = [];
      profileRow = { onboarding_completed_at: null, onboarding_skipped_at: null };

      const response = await GET(getRequest());

      expect(response.status).toBe(200);
      const body = await json<GetBody>(response);
      expect(body.onboarding).toEqual({
        onboarding_completed_at: null,
        onboarding_skipped_at: null,
        needs_onboarding: true,
      });
    });
  });
});
