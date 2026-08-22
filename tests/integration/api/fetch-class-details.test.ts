import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';

const {
  AuthError,
  NotFoundError,
  mockFetchClassFromASU,
  mockUpsertClassState,
  mockCreateClient,
  mockGetUser,
} = vi.hoisted(() => {
  class MockNotFoundError extends Error {}
  class MockAuthError extends Error {}

  return {
    AuthError: MockAuthError,
    NotFoundError: MockNotFoundError,
    mockFetchClassFromASU: vi.fn(),
    mockUpsertClassState: vi.fn(),
    mockCreateClient: vi.fn(),
    mockGetUser: vi.fn(),
  };
});

vi.mock('cloudflare:workers', () => ({
  env: {
    ASU_API_BASE_URL: 'https://classes.example.test',
    ASU_API_TOKEN: 'test-token',
  },
}));

vi.mock('@/lib/asu/api', () => ({
  AuthError,
  NotFoundError,
  fetchClassFromASU: mockFetchClassFromASU,
}));

// upsertClassState lives in lib/db/queries (uses execute under the hood) —
// stub it so the test can assert it's invoked and control failure cases.
vi.mock('@/lib/db/queries', () => ({
  upsertClassState: mockUpsertClassState,
}));

// Stub the full db/client surface so no real pg Pool is constructed.
vi.mock('@/lib/db/client', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  queryScalar: vi.fn(),
  execute: vi.fn(),
  callFunction: vi.fn(),
  callFunctionScalar: vi.fn(),
  getClient: vi.fn(),
  setConnectionStringGetter: vi.fn(),
}));

// Auth stays on Supabase (supabase.auth.getUser via withAuth).
vi.mock('@/lib/supabase/server', () => ({
  createClient: mockCreateClient,
}));

import { POST } from '@/app/api/fetch-class-details/route';

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

const classDetails = {
  subject: 'CSE',
  catalog_nbr: '240',
  title: 'Intro to Programming',
  instructor_name: 'Dr. Smith',
  seats_available: 7,
  seats_capacity: 40,
  non_reserved_seats: 3,
  location: 'Tempe',
  meeting_times: 'MWF 9:00 AM-9:50 AM',
};

function request(body: Record<string, JsonValue>): NextRequest {
  return new NextRequest('https://pickmyclass.app/api/fetch-class-details', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

async function json(response: Response) {
  // SAFETY: test helper parses JSON response; shape asserted per test case via property access
  return response.json() as Promise<Record<string, JsonValue>>;
}
describe.skip('/api/fetch-class-details', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-15T12:00:00Z'));
    vi.clearAllMocks();
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'test-user-id', email: 'test@example.com' } },
      error: null,
    });
    mockCreateClient.mockResolvedValue({ auth: { getUser: mockGetUser } });
    mockFetchClassFromASU.mockResolvedValue(classDetails);
    mockUpsertClassState.mockResolvedValue(undefined);
  });

  afterEach(() => {
    errorSpy.mockRestore();
    logSpy.mockRestore();
    vi.useRealTimers();
  });

  it('rejects invalid class detail requests', async () => {
    const response = await POST(request({ term: '2264', class_nbr: 'abc' }));
    const data = await json(response);

    expect(response.status).toBe(400);
    expect(data.error).toBe('Invalid input');
    expect(mockFetchClassFromASU).not.toHaveBeenCalled();
  });

  it('fetches ASU details, persists the class state, and returns display data', async () => {
    const response = await POST(request({ term: '2264', class_nbr: '12345' }));
    const data = await json(response);

    expect(response.status).toBe(200);
    expect(data).toMatchObject({
      subject: 'CSE',
      catalog_nbr: '240',
      instructor_name: 'Dr. Smith',
      seats_available: 7,
    });
    expect(mockFetchClassFromASU).toHaveBeenCalledWith(
      { class_nbr: '12345', term: '2264' },
      {
        ASU_API_BASE_URL: 'https://classes.example.test',
        ASU_API_TOKEN: 'test-token',
      }
    );
    // upsertClassState(ref, details) replaces the old service .upsert(...) call.
    // The first arg is the SectionRef; the second is the ASU ClassDetails.
    expect(mockUpsertClassState).toHaveBeenCalledWith(
      { class_nbr: '12345', term: '2264' },
      expect.objectContaining({
        non_reserved_seats: 3,
        seats_available: 7,
      })
    );
  });

  it('maps ASU not-found errors to 404', async () => {
    mockFetchClassFromASU.mockRejectedValueOnce(new NotFoundError('missing'));

    const response = await POST(request({ term: '2264', class_nbr: '12345' }));
    const data = await json(response);

    expect(response.status).toBe(404);
    expect(data.error).toBe('Class section not found');
  });

  it('maps ASU auth failures to a temporary service outage', async () => {
    mockFetchClassFromASU.mockRejectedValueOnce(new AuthError('expired token'));

    const response = await POST(request({ term: '2264', class_nbr: '12345' }));
    const data = await json(response);

    expect(response.status).toBe(503);
    expect(data.error).toBe('Service temporarily unavailable');
  });

  it('maps unexpected ASU failures to a fetch error', async () => {
    mockFetchClassFromASU.mockRejectedValueOnce(new Error('network down'));

    const response = await POST(request({ term: '2264', class_nbr: '12345' }));
    const data = await json(response);

    expect(response.status).toBe(500);
    expect(data.error).toBe('Failed to fetch class details');
  });

  it('still returns class details when persistence returns an error', async () => {
    mockUpsertClassState.mockRejectedValueOnce(new Error('write failed'));

    const response = await POST(request({ term: '2264', class_nbr: '12345' }));
    const data = await json(response);

    expect(response.status).toBe(200);
    expect(data.title).toBe('Intro to Programming');
  });

  it('still returns class details when persistence throws', async () => {
    mockUpsertClassState.mockImplementationOnce(() => {
      throw new Error('service client unavailable');
    });

    const response = await POST(request({ term: '2264', class_nbr: '12345' }));
    const data = await json(response);

    expect(response.status).toBe(200);
    expect(data.meeting_times).toBe('MWF 9:00 AM-9:50 AM');
    expect(mockUpsertClassState).toHaveBeenCalledTimes(1);
  });

  it('rejects unauthenticated requests', async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null }, error: null });
    const response = await POST(request({ term: '2264', class_nbr: '12345' }));
    expect(response.status).toBe(401);
  });
});
