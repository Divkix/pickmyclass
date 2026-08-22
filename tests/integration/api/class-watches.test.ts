// @ts-nocheck — skipped Clerk migration placeholder; rewrite to mock clerk-session (tracked in issue #351)
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import type { ValidationIssueDetail } from '@/lib/api/validation';

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
// Response types
interface ClassWatch {
  id: string;
  user_id: string;
  term: string;
  subject: string;
  catalog_nbr: string;
  class_nbr: string;
  created_at: string;
  class_state?: ClassState | null;
}

interface ClassState {
  class_nbr: string;
  term: string;
  subject: string;
  catalog_nbr: string;
  title: string;
  instructor_name: string;
  seats_available: number;
  seats_capacity: number;
}

interface GetResponse {
  watches?: ClassWatch[];
  maxWatches?: number;
  onboarding?: {
    onboarding_completed_at: string | null;
    onboarding_skipped_at: string | null;
    needs_onboarding: boolean;
  };
  error?: string;
}

interface PostResponse {
  watch?: ClassWatch;
  error?: string;
  details?: ValidationIssueDetail[];
}

interface DeleteResponse {
  success?: boolean;
  error?: string;
  details?: ValidationIssueDetail[];
}

// Mock data
const mockUser = { id: 'user-123', email: 'test@example.com' };
const mockWatch: ClassWatch = {
  id: 'watch-1',
  user_id: 'user-123',
  term: '2264',
  subject: 'CSE',
  catalog_nbr: '240',
  class_nbr: '12345',
  created_at: '2024-06-15T12:00:00Z',
};
const mockClassState: ClassState = {
  class_nbr: '12345',
  term: '2264',
  subject: 'CSE',
  catalog_nbr: '240',
  title: 'Intro to Programming',
  instructor_name: 'John Doe',
  seats_available: 10,
  seats_capacity: 50,
};
const mockClassDetails = {
  subject: 'CSE',
  catalog_nbr: '240',
  title: 'Intro to Programming',
  instructor_name: 'John Doe',
  seats_available: 10,
  seats_capacity: 50,
  non_reserved_seats: null,
  location: 'COOR 120',
  meeting_times: 'MWF 9:00 AM-9:50 AM',
};

// Hoisted mock functions (vi.mock factories run before imports, so all refs
// referenced inside factories must be declared via vi.hoisted).
const {
  mockCreateClient,
  mockGetUser,
  mockQuery,
  mockQueryOne,
  mockCallFunction,
  mockExecute,
  mockFetchClassFromASU,
  mockUpsertClassState,
  mockApplyFirstWatchGuard,
  mockCaptureServerEvent,
  NotFoundError,
  AuthError,
} = vi.hoisted(() => {
  class MockNotFoundError extends Error {}
  class MockAuthError extends Error {}
  return {
    mockCreateClient: vi.fn(),
    mockGetUser: vi.fn(),
    mockQuery: vi.fn(),
    mockQueryOne: vi.fn(),
    mockCallFunction: vi.fn(),
    mockExecute: vi.fn(),
    mockFetchClassFromASU: vi.fn(),
    mockUpsertClassState: vi.fn(),
    mockApplyFirstWatchGuard: vi.fn(),
    mockCaptureServerEvent: vi.fn().mockResolvedValue(undefined),
    NotFoundError: MockNotFoundError,
    AuthError: MockAuthError,
  };
});

// Auth stays on Supabase (supabase.auth.getUser) — only the data plane moved
// to PlanetScale/Hyperdrive, so keep the server client mock but strip data access.
vi.mock('@/lib/supabase/server', () => ({
  createClient: mockCreateClient,
}));

// New data-plane seam: lib/db/client (replaces lib/supabase/service).
vi.mock('@/lib/db/client', () => ({
  query: mockQuery,
  queryOne: mockQueryOne,
  queryScalar: vi.fn(),
  execute: mockExecute,
  callFunction: mockCallFunction,
  callFunctionScalar: vi.fn(),
  getClient: vi.fn(),
  setConnectionStringGetter: vi.fn(),
}));

// upsertClassState lives in lib/db/queries and is imported by the route.
vi.mock('@/lib/db/queries', () => ({
  upsertClassState: mockUpsertClassState,
}));

// Keep real toOnboardingState/onboardingStatus; only stub the persistence guard
// (applyFirstWatchGuard) so the test can assert it's invoked on first watch.
vi.mock('@/lib/onboarding', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/onboarding')>()),
  applyFirstWatchGuard: mockApplyFirstWatchGuard,
}));

// Mock ASU API client
vi.mock('@/lib/asu/api', () => ({
  fetchClassFromASU: mockFetchClassFromASU,
  NotFoundError,
  AuthError,
}));

// PostHog server events fail open — stub so no network calls happen in tests.
vi.mock('@/lib/posthog-server', () => ({
  captureServerEvent: mockCaptureServerEvent,
}));

// Mock cloudflare:workers for env import
vi.mock('cloudflare:workers', () => ({
  env: {
    ASU_API_BASE_URL: 'https://mock-asu-api.example.com',
    ASU_API_TOKEN: 'mock-token',
  },
}));

import { DELETE, GET, POST } from '@/app/api/class-watches/route';

// Per-test mutable results for the query/queryOne mocks. The route issues
// multiple `query` calls per GET (class_watches, then class_states) plus a
// `queryOne` for the onboarding profile; the mock dispatches on SQL text.
// SAFETY: test fixtures are controlled row shapes matching the route's typed SELECT contracts
let watchesResult: ClassWatch[] = [];
// SAFETY: test fixtures are controlled row shapes matching the route's typed SELECT contracts
let classStatesResult: ClassState[] = [];
let profileResult: {
  onboarding_completed_at: string | null;
  onboarding_skipped_at: string | null;
};

// Response parsers
async function parseGetResponse(response: Response): Promise<GetResponse> {
  // SAFETY: test helper parses mocked fetch Response JSON; shape is GetResponse per route contract and test fixtures
  return (await response.json()) as GetResponse;
}

async function parsePostResponse(response: Response): Promise<PostResponse> {
  // SAFETY: test helper parses mocked fetch Response JSON; shape is PostResponse per route contract and test fixtures
  return (await response.json()) as PostResponse;
}

async function parseDeleteResponse(response: Response): Promise<DeleteResponse> {
  // SAFETY: test helper parses mocked fetch Response JSON; shape is DeleteResponse per route contract and test fixtures
  return (await response.json()) as DeleteResponse;
}

describe.skip('/api/class-watches', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-15T12:00:00Z'));
    vi.clearAllMocks();

    // Default per-test fixtures
    watchesResult = [];
    classStatesResult = [];
    // eslint-disable-next-line anti-slop/no-known-value-widening -- SAFETY: test double for onboarding profile row
    profileResult = {
      onboarding_completed_at: '2026-01-01T00:00:00Z',
      onboarding_skipped_at: null,
    };

    mockGetUser.mockResolvedValue({ data: { user: mockUser }, error: null });
    mockCreateClient.mockResolvedValue({ auth: { getUser: mockGetUser } });

    // Dispatch `query` by SQL text: class_watches list vs class_states lookup.
    mockQuery.mockImplementation(async (text: string) => {
      if (text.includes('FROM class_watches WHERE user_id')) return watchesResult;
      if (text.includes('FROM class_states')) return classStatesResult;
      return [];
    });
    // Dispatch `queryOne` by SQL text: user_profiles onboarding read.
    mockQueryOne.mockImplementation(async (text: string) => {
      if (text.includes('FROM user_profiles')) return profileResult;
      return null;
    });

    mockExecute.mockResolvedValue(1);
    mockCallFunction.mockResolvedValue([mockWatch]);
    mockFetchClassFromASU.mockResolvedValue(mockClassDetails);
    mockUpsertClassState.mockResolvedValue(undefined);
    mockApplyFirstWatchGuard.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('GET /api/class-watches', () => {
    it('should return 401 for unauthenticated requests', async () => {
      mockGetUser.mockResolvedValue({ data: { user: null }, error: { message: 'Unauthorized' } });

      const response = await GET();
      const data = await parseGetResponse(response);

      expect(response.status).toBe(401);
      expect(data.error).toBe('Unauthorized');
    });

    it('should return empty watches for authenticated user with no watches', async () => {
      const response = await GET();
      const data = await parseGetResponse(response);

      expect(response.status).toBe(200);
      expect(data.watches).toEqual([]);
      expect(data.maxWatches).toBeDefined();
      expect(data.onboarding).toMatchObject({
        onboarding_completed_at: expect.any(String),
        needs_onboarding: false,
      });
    });

    it('should return watches with joined class states', async () => {
      watchesResult = [mockWatch];
      classStatesResult = [mockClassState];

      const response = await GET();
      const data = await parseGetResponse(response);

      expect(response.status).toBe(200);
      expect(data.watches).toHaveLength(1);
      expect(data.watches?.[0].class_state).toEqual(mockClassState);
    });

    it('should handle database errors', async () => {
      mockQuery.mockRejectedValueOnce(new Error('Database error'));

      const response = await GET();
      const data = await parseGetResponse(response);

      expect(response.status).toBe(500);
      expect(data.error).toBe('Failed to fetch class watches');
    });
  });

  describe('POST /api/class-watches', () => {
    const createRequest = (body: Record<string, JsonValue>): NextRequest => {
      return new NextRequest('http://localhost:3000/api/class-watches', {
        method: 'POST',
        body: JSON.stringify(body),
        headers: {
          'Content-Type': 'application/json',
        },
      });
    };

    it('should return 401 for unauthenticated requests', async () => {
      mockGetUser.mockResolvedValue({ data: { user: null }, error: { message: 'Unauthorized' } });

      const request = createRequest({ term: '2264', class_nbr: '12345' });
      const response = await POST(request);
      const data = await parsePostResponse(response);

      expect(response.status).toBe(401);
      expect(data.error).toBe('Unauthorized');
    });

    it('should return 400 for invalid term format', async () => {
      const request = createRequest({ term: 'invalid', class_nbr: '12345' });
      const response = await POST(request);
      const data = await parsePostResponse(response);

      expect(response.status).toBe(400);
      expect(data.error).toBe('Invalid input');
      expect(data.details).toContainEqual(
        expect.objectContaining({
          field: 'term',
        })
      );
    });

    it('should return 400 for invalid class_nbr format', async () => {
      const request = createRequest({ term: '2264', class_nbr: '123' });
      const response = await POST(request);
      const data = await parsePostResponse(response);

      expect(response.status).toBe(400);
      expect(data.error).toBe('Invalid input');
    });

    it('should return 429 when max watches limit reached', async () => {
      mockCallFunction.mockRejectedValueOnce({
        code: 'P0001',
        message: 'MAX_WATCHES_EXCEEDED: user has 10 watches',
      });

      const request = createRequest({ term: '2264', class_nbr: '12345' });
      const response = await POST(request);
      const data = await parsePostResponse(response);

      expect(response.status).toBe(429);
      expect(data.error).toContain('Maximum watches limit reached');
    });

    it('should return 409 for duplicate watch', async () => {
      mockCallFunction.mockRejectedValueOnce({
        code: '23505',
        message: 'Unique constraint violation',
      });

      const request = createRequest({ term: '2264', class_nbr: '12345' });
      const response = await POST(request);
      const data = await parsePostResponse(response);

      expect(response.status).toBe(409);
      expect(data.error).toBe('You are already watching this class');
    });

    it('should return 429 when atomic insert reports limit exceeded', async () => {
      mockCallFunction.mockRejectedValueOnce({
        code: 'P0001',
        message: 'MAX_WATCHES_EXCEEDED',
      });

      const request = createRequest({ term: '2264', class_nbr: '12345' });
      const response = await POST(request);
      const data = await parsePostResponse(response);

      expect(response.status).toBe(429);
      expect(data.error).toContain('Maximum watches limit reached');
    });

    it('should return 500 when ASU API fetch fails', async () => {
      mockFetchClassFromASU.mockRejectedValueOnce(new Error('Network error'));

      const request = createRequest({ term: '2264', class_nbr: '12345' });
      const response = await POST(request);
      const data = await parsePostResponse(response);

      expect(response.status).toBe(500);
      expect(data.error).toBe('Failed to fetch class details');
    });

    it('should return 404 when class section not found', async () => {
      // Import the mock class to throw the right error type
      const { NotFoundError: NFE } = await import('@/lib/asu/api');
      mockFetchClassFromASU.mockRejectedValueOnce(new NFE('Section 99999 not found'));

      const request = createRequest({ term: '2264', class_nbr: '99999' });
      const response = await POST(request);
      const data = await parsePostResponse(response);

      expect(response.status).toBe(404);
      expect(data.error).toBe('Class section not found');
    });

    it('should return 503 when ASU API auth fails', async () => {
      const { AuthError: AE } = await import('@/lib/asu/api');
      mockFetchClassFromASU.mockRejectedValueOnce(new AE('Token expired'));

      const request = createRequest({ term: '2264', class_nbr: '12345' });
      const response = await POST(request);
      const data = await parsePostResponse(response);

      expect(response.status).toBe(503);
      expect(data.error).toBe('Service temporarily unavailable');
    });

    it('should create watch successfully with ASU API data', async () => {
      const request = createRequest({ term: '2264', class_nbr: '12345' });
      const response = await POST(request);
      const data = await parsePostResponse(response);

      expect(response.status).toBe(201);
      expect(data.watch).toBeDefined();
      expect(mockFetchClassFromASU).toHaveBeenCalledWith(
        { class_nbr: '12345', term: '2264' },
        {
          ASU_API_BASE_URL: expect.any(String),
          ASU_API_TOKEN: expect.any(String),
        }
      );
      // callFunction replaces .rpc(): function name + positional params array.
      // Params: [user_id, term, subject(upper), catalog_nbr, class_nbr, max_watches].
      expect(mockCallFunction).toHaveBeenCalledWith('create_class_watch_with_limit', [
        mockUser.id,
        '2264',
        'CSE',
        '240',
        '12345',
        10,
      ]);
      // upsertClassState(ref, details) replaces the old service .upsert(...) call.
      expect(mockUpsertClassState).toHaveBeenCalledWith(
        { class_nbr: '12345', term: '2264' },
        expect.objectContaining({
          subject: 'CSE',
          catalog_nbr: '240',
          seats_available: 10,
        })
      );
      // Onboarding is marked complete on the user's first watch via the guard.
      // Issue #307: the guard filters ONLY on onboarding_completed_at IS NULL,
      // not on onboarding_skipped_at, so a skipped user still completes.
      expect(mockApplyFirstWatchGuard).toHaveBeenCalledWith(mockUser.id);
    });
  });

  describe('DELETE /api/class-watches', () => {
    const createDeleteRequest = (id: string | null): NextRequest => {
      const url = id
        ? `http://localhost:3000/api/class-watches?id=${id}`
        : 'http://localhost:3000/api/class-watches';
      return new NextRequest(url, {
        method: 'DELETE',
      });
    };

    it('should return 401 for unauthenticated requests', async () => {
      mockGetUser.mockResolvedValue({ data: { user: null }, error: { message: 'Unauthorized' } });

      const request = createDeleteRequest('550e8400-e29b-41d4-a716-446655440000');
      const response = await DELETE(request);
      const data = await parseDeleteResponse(response);

      expect(response.status).toBe(401);
      expect(data.error).toBe('Unauthorized');
    });

    it('should return 400 for invalid UUID format', async () => {
      const request = createDeleteRequest('not-a-uuid');
      const response = await DELETE(request);
      const data = await parseDeleteResponse(response);

      expect(response.status).toBe(400);
      expect(data.error).toBe('Invalid input');
    });

    it('should return 400 for missing ID', async () => {
      const request = createDeleteRequest(null);
      const response = await DELETE(request);

      expect(response.status).toBe(400);
    });

    it('should delete watch successfully', async () => {
      const request = createDeleteRequest('550e8400-e29b-41d4-a716-446655440000');
      const response = await DELETE(request);
      const data = await parseDeleteResponse(response);

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
    });

    it('should handle database errors on delete', async () => {
      mockExecute.mockRejectedValueOnce(new Error('Database error'));

      const request = createDeleteRequest('550e8400-e29b-41d4-a716-446655440000');
      const response = await DELETE(request);
      const data = await parseDeleteResponse(response);

      expect(response.status).toBe(500);
      expect(data.error).toBe('Failed to delete class watch');
    });
  });
});
