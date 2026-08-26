/**
 * /api/onboarding/popular-class over the Drizzle boundary. The route resolves
 * ONE request-scoped handle via getDbFromEnv and passes it to the
 * getMostWatchedClass RPC helper (stubbed here to script outcomes); any
 * failure fails open to popularClass: null so onboarding never blocks.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';

import { GET } from '@/app/api/onboarding/popular-class/route';
import type { ClassDetails } from '@/lib/types/class';

const {
  mockGetDbFromEnv,
  mockGetSessionIdentity,
  mockGetMostWatchedClass,
  mockFetchClassFromASU,
  mockGetSelectableTerms,
  NotFoundError,
} = vi.hoisted(() => ({
  mockGetDbFromEnv: vi.fn(),
  mockGetSessionIdentity: vi.fn(),
  mockGetMostWatchedClass: vi.fn(),
  mockFetchClassFromASU: vi.fn(),
  mockGetSelectableTerms: vi.fn(),
  NotFoundError: class NotFoundError extends Error {},
}));

vi.mock('@/lib/auth/clerk-session', () => ({
  getSessionIdentity: mockGetSessionIdentity,
}));

// Sentinel request-scoped handle threaded into the query helper. Flows only
// through the mocked '@/lib/db' factory, so it needs no Database cast —
// identity is asserted via toHaveBeenCalledWith.
const requestDb = { __sentinel: 'popular-class-request-db' };

vi.mock('@/lib/db', () => ({
  getDbFromEnv: () => requestDb,
}));

vi.mock('@/lib/db/queries', () => ({
  getMostWatchedClass: (...args: unknown[]) => mockGetMostWatchedClass(...args),
}));

vi.mock('@/lib/asu/api', () => ({
  fetchClassFromASU: (...args: unknown[]) => mockFetchClassFromASU(...args),
  NotFoundError,
}));

vi.mock('@/lib/asu/terms', () => ({
  getSelectableTerms: (...args: unknown[]) => mockGetSelectableTerms(...args),
}));

vi.mock('cloudflare:workers', () => ({
  env: {
    ASU_API_BASE_URL: 'https://mock-asu-api.example.com',
    ASU_API_TOKEN: 'mock-token',
  },
}));

const identity = { userId: 'user-123', clerkUserId: 'clerk_123', sessionId: 'sess_123' };

const classDetails: ClassDetails = {
  subject: 'CSE',
  catalog_nbr: '240',
  title: 'Intro to Programming',
  instructor_name: 'Dr. Smith',
  seats_available: 7,
  seats_capacity: 50,
  non_reserved_seats: 3,
  location: 'COOR 120',
  meeting_times: 'MWF 9:00 AM-9:50 AM',
};

/** JSON payload values the route handler serializes. */
type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

async function json(response: Response) {
  // SAFETY: test helper parses JSON response; shape asserted per test case via property access
  return response.json() as Promise<Record<string, JsonValue>>;
}

describe('/api/onboarding/popular-class', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockGetDbFromEnv.mockImplementation(() => requestDb);
    mockGetSessionIdentity.mockResolvedValue(identity);
    mockGetSelectableTerms.mockReturnValue([{ code: '2267' }]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects unauthenticated requests without querying the database', async () => {
    mockGetSessionIdentity.mockResolvedValueOnce(null);

    const response = await GET(new Request('https://pickmyclass.app/api/onboarding/popular-class'));
    const data = await json(response);

    expect(response.status).toBe(401);
    expect(data.error).toBe('Unauthorized');
    expect(mockGetDbFromEnv).not.toHaveBeenCalled();
    expect(mockGetMostWatchedClass).not.toHaveBeenCalled();
  });

  it('returns popularClass=null when no term is selectable', async () => {
    mockGetSelectableTerms.mockReturnValue([]);

    const response = await GET(new Request('https://pickmyclass.app/api/onboarding/popular-class'));
    const data = await json(response);

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.popularClass).toBeNull();
    expect(mockGetDbFromEnv).not.toHaveBeenCalled();
    expect(mockGetMostWatchedClass).not.toHaveBeenCalled();
  });

  it('returns popularClass=null when no popular class exists for the term', async () => {
    mockGetMostWatchedClass.mockResolvedValue(null);

    const response = await GET(new Request('https://pickmyclass.app/api/onboarding/popular-class'));
    const data = await json(response);

    expect(response.status).toBe(200);
    expect(data.popularClass).toBeNull();
    // The single request-scoped handle is threaded into the query helper.
    expect(mockGetMostWatchedClass).toHaveBeenCalledTimes(1);
    expect(mockGetMostWatchedClass).toHaveBeenCalledWith(requestDb, '2267');
    expect(mockFetchClassFromASU).not.toHaveBeenCalled();
  });

  it('returns the validated popular class with ASU details', async () => {
    mockGetMostWatchedClass.mockResolvedValue({ class_nbr: '12345', term: '2267' });
    mockFetchClassFromASU.mockResolvedValue(classDetails);

    const response = await GET(new Request('https://pickmyclass.app/api/onboarding/popular-class'));
    const data = await json(response);

    expect(response.status).toBe(200);
    expect(data.popularClass).toEqual({
      class_nbr: '12345',
      term: '2267',
      details: classDetails,
    });
    expect(mockFetchClassFromASU).toHaveBeenCalledWith(
      { class_nbr: '12345', term: '2267' },
      { ASU_API_BASE_URL: 'https://mock-asu-api.example.com', ASU_API_TOKEN: 'mock-token' }
    );
  });

  it('fails open to popularClass=null when ASU returns NotFound', async () => {
    mockGetMostWatchedClass.mockResolvedValue({ class_nbr: '12345', term: '2267' });
    mockFetchClassFromASU.mockRejectedValue(new NotFoundError('Section 12345 not found'));

    const response = await GET(new Request('https://pickmyclass.app/api/onboarding/popular-class'));
    const data = await json(response);

    expect(response.status).toBe(200);
    expect(data.popularClass).toBeNull();
  });

  it('fails open to popularClass=null on a generic ASU API error', async () => {
    mockGetMostWatchedClass.mockResolvedValue({ class_nbr: '12345', term: '2267' });
    mockFetchClassFromASU.mockRejectedValue(new Error('ASU API returned 500'));

    const response = await GET(new Request('https://pickmyclass.app/api/onboarding/popular-class'));
    const data = await json(response);

    expect(response.status).toBe(200);
    expect(data.popularClass).toBeNull();
  });

  it('fails open to popularClass=null when the most-watched lookup throws', async () => {
    mockGetMostWatchedClass.mockRejectedValue(new Error('db down'));

    const response = await GET(new Request('https://pickmyclass.app/api/onboarding/popular-class'));
    const data = await json(response);

    expect(response.status).toBe(200);
    expect(data.popularClass).toBeNull();
  });
});
