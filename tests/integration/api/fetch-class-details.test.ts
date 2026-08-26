/**
 * /api/fetch-class-details over the Drizzle boundary: auth gating, ASU error
 * mapping, the class_states persistence hand-off, and its graceful
 * degradation. The route resolves ONE request-scoped handle via getDbFromEnv
 * and passes it to upsertClassState; that seam is stubbed here so persistence
 * outcomes can be scripted without a database.
 */
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';

import { getSelectableTerms } from '@/lib/asu/terms';
import type { ClassDetails } from '@/lib/types/class';

const {
  AuthError,
  NotFoundError,
  mockFetchClassFromASU,
  mockUpsertClassState,
  mockGetSessionIdentity,
} = vi.hoisted(() => {
  class MockNotFoundError extends Error {}
  class MockAuthError extends Error {}

  return {
    AuthError: MockAuthError,
    NotFoundError: MockNotFoundError,
    mockFetchClassFromASU: vi.fn(),
    mockUpsertClassState: vi.fn(),
    mockGetSessionIdentity: vi.fn(),
  };
});

vi.mock('@/lib/auth/clerk-session', () => ({
  getSessionIdentity: mockGetSessionIdentity,
}));

// Sentinel handle: the route must create exactly one and hand it to the
// persistence helper. Flows only through the mocked '@/lib/db' factory, so it
// needs no Database cast — identity is asserted via toHaveBeenCalledWith.
const requestDb = { __sentinel: 'fetch-class-details-request-db' };

vi.mock('@/lib/db', () => ({
  getDbFromEnv: () => requestDb,
}));

vi.mock('@/lib/asu/api', () => ({
  fetchClassFromASU: mockFetchClassFromASU,
  NotFoundError,
  AuthError,
}));

// upsertClassState lives in lib/db/queries — stub it so the test can assert
// the request-scoped db is threaded through and control failure cases.
vi.mock('@/lib/db/queries', () => ({
  upsertClassState: mockUpsertClassState,
}));

vi.mock('cloudflare:workers', () => ({
  env: {
    ASU_API_BASE_URL: 'https://classes.example.test',
    ASU_API_TOKEN: 'test-token',
  },
}));

import { POST } from '@/app/api/fetch-class-details/route';

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

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

// Any currently selectable term satisfies fetchClassDetailsSchema's refinement.
const SELECTABLE_TERM = getSelectableTerms()[0].code;

function request(body: Record<string, JsonValue>): NextRequest {
  return new NextRequest('http://localhost:3000/api/fetch-class-details', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

async function json(response: Response) {
  // SAFETY: test helper parses JSON response; shape asserted per test case via property access
  return response.json() as Promise<Record<string, JsonValue>>;
}

describe('/api/fetch-class-details', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mockGetSessionIdentity.mockResolvedValue(identity);
    mockFetchClassFromASU.mockResolvedValue(classDetails);
    mockUpsertClassState.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects invalid class detail requests', async () => {
    const response = await POST(request({ term: SELECTABLE_TERM, class_nbr: 'abc' }));
    const data = await json(response);

    expect(response.status).toBe(400);
    expect(data.error).toBe('Invalid input');
    expect(mockFetchClassFromASU).not.toHaveBeenCalled();
    expect(mockUpsertClassState).not.toHaveBeenCalled();
  });

  it('fetches ASU details, persists the class state on the request handle, and returns display data', async () => {
    const response = await POST(request({ term: SELECTABLE_TERM, class_nbr: '12345' }));
    const data = await json(response);

    expect(response.status).toBe(200);
    expect(data).toMatchObject({
      subject: 'CSE',
      catalog_nbr: '240',
      instructor_name: 'Dr. Smith',
      seats_available: 7,
    });
    expect(mockFetchClassFromASU).toHaveBeenCalledWith(
      { class_nbr: '12345', term: SELECTABLE_TERM },
      {
        ASU_API_BASE_URL: 'https://classes.example.test',
        ASU_API_TOKEN: 'test-token',
      }
    );
    // The single request-scoped handle is threaded into the persistence helper.
    expect(mockUpsertClassState).toHaveBeenCalledTimes(1);
    expect(mockUpsertClassState).toHaveBeenCalledWith(
      requestDb,
      { class_nbr: '12345', term: SELECTABLE_TERM },
      expect.objectContaining({
        non_reserved_seats: 3,
        seats_available: 7,
      })
    );
  });

  it('maps ASU not-found errors to 404', async () => {
    mockFetchClassFromASU.mockRejectedValueOnce(new NotFoundError('missing'));

    const response = await POST(request({ term: SELECTABLE_TERM, class_nbr: '12345' }));
    const data = await json(response);

    expect(response.status).toBe(404);
    expect(data.error).toBe('Class section not found');
  });

  it('maps ASU auth failures to a temporary service outage', async () => {
    mockFetchClassFromASU.mockRejectedValueOnce(new AuthError('expired token'));

    const response = await POST(request({ term: SELECTABLE_TERM, class_nbr: '12345' }));
    const data = await json(response);

    expect(response.status).toBe(503);
    expect(data.error).toBe('Service temporarily unavailable');
  });

  it('maps unexpected ASU failures to a fetch error', async () => {
    mockFetchClassFromASU.mockRejectedValueOnce(new Error('network down'));

    const response = await POST(request({ term: SELECTABLE_TERM, class_nbr: '12345' }));
    const data = await json(response);

    expect(response.status).toBe(500);
    expect(data.error).toBe('Failed to fetch class details');
  });

  it('still returns class details when persistence rejects', async () => {
    mockUpsertClassState.mockRejectedValueOnce(new Error('write failed'));

    const response = await POST(request({ term: SELECTABLE_TERM, class_nbr: '12345' }));
    const data = await json(response);

    expect(response.status).toBe(200);
    expect(data.title).toBe('Intro to Programming');
  });

  it('still returns class details when persistence throws synchronously', async () => {
    mockUpsertClassState.mockImplementationOnce(() => {
      throw new Error('service client unavailable');
    });

    const response = await POST(request({ term: SELECTABLE_TERM, class_nbr: '12345' }));
    const data = await json(response);

    expect(response.status).toBe(200);
    expect(data.meeting_times).toBe('MWF 9:00 AM-9:50 AM');
    expect(mockUpsertClassState).toHaveBeenCalledTimes(1);
  });

  it('rejects unauthenticated requests without fetching or persisting', async () => {
    mockGetSessionIdentity.mockResolvedValueOnce(null);

    const response = await POST(request({ term: SELECTABLE_TERM, class_nbr: '12345' }));

    expect(response.status).toBe(401);
    expect(mockFetchClassFromASU).not.toHaveBeenCalled();
    expect(mockUpsertClassState).not.toHaveBeenCalled();
  });
});
