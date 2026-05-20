import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { AuthError, NotFoundError, mockFetchClassFromASU, mockGetServiceClient, mockUpsert } =
  vi.hoisted(() => {
    class MockNotFoundError extends Error {}
    class MockAuthError extends Error {}

    return {
      AuthError: MockAuthError,
      NotFoundError: MockNotFoundError,
      mockFetchClassFromASU: vi.fn(),
      mockGetServiceClient: vi.fn(),
      mockUpsert: vi.fn(),
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

vi.mock('@/lib/supabase/service', () => ({
  getServiceClient: mockGetServiceClient,
}));

import { POST } from '@/app/api/fetch-class-details/route';

const classDetails = {
  subject: 'CSE',
  catalog_nbr: '240',
  title: 'Intro to Programming',
  instructor: 'Dr. Smith',
  seats_available: 7,
  seats_capacity: 40,
  non_reserved_seats: 3,
  location: 'Tempe',
  meeting_times: 'MWF 9:00 AM-9:50 AM',
};

function request(body: unknown): NextRequest {
  return new NextRequest('https://pickmyclass.app/api/fetch-class-details', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

async function json(response: Response) {
  return response.json() as Promise<Record<string, unknown>>;
}

describe('/api/fetch-class-details', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    mockFetchClassFromASU.mockResolvedValue(classDetails);
    mockUpsert.mockResolvedValue({ error: null });
    mockGetServiceClient.mockReturnValue({
      from: vi.fn(() => ({
        upsert: mockUpsert,
      })),
    });
  });

  afterEach(() => {
    errorSpy.mockRestore();
    logSpy.mockRestore();
  });

  it('rejects invalid class detail requests', async () => {
    const response = await POST(request({ term: '2261', class_nbr: 'abc' }));
    const data = await json(response);

    expect(response.status).toBe(400);
    expect(data.error).toBe('Invalid input');
    expect(mockFetchClassFromASU).not.toHaveBeenCalled();
  });

  it('fetches ASU details, persists the class state, and returns display data', async () => {
    const response = await POST(request({ term: '2261', class_nbr: '12345' }));
    const data = await json(response);

    expect(response.status).toBe(200);
    expect(data).toMatchObject({
      subject: 'CSE',
      catalog_nbr: '240',
      instructor_name: 'Dr. Smith',
      seats_available: 7,
    });
    expect(mockFetchClassFromASU).toHaveBeenCalledWith('12345', '2261', {
      ASU_API_BASE_URL: 'https://classes.example.test',
      ASU_API_TOKEN: 'test-token',
    });
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        term: '2261',
        class_nbr: '12345',
        non_reserved_seats: 3,
      }),
      { onConflict: 'class_nbr' }
    );
  });

  it('maps ASU not-found errors to 404', async () => {
    mockFetchClassFromASU.mockRejectedValueOnce(new NotFoundError('missing'));

    const response = await POST(request({ term: '2261', class_nbr: '12345' }));
    const data = await json(response);

    expect(response.status).toBe(404);
    expect(data.error).toBe('Class section not found');
  });

  it('maps ASU auth failures to a temporary service outage', async () => {
    mockFetchClassFromASU.mockRejectedValueOnce(new AuthError('expired token'));

    const response = await POST(request({ term: '2261', class_nbr: '12345' }));
    const data = await json(response);

    expect(response.status).toBe(503);
    expect(data.error).toBe('Service temporarily unavailable');
  });

  it('maps unexpected ASU failures to a fetch error', async () => {
    mockFetchClassFromASU.mockRejectedValueOnce(new Error('network down'));

    const response = await POST(request({ term: '2261', class_nbr: '12345' }));
    const data = await json(response);

    expect(response.status).toBe(500);
    expect(data.error).toBe('Failed to fetch class details');
  });

  it('still returns class details when persistence returns an error', async () => {
    mockUpsert.mockResolvedValueOnce({ error: { message: 'write failed' } });

    const response = await POST(request({ term: '2261', class_nbr: '12345' }));
    const data = await json(response);

    expect(response.status).toBe(200);
    expect(data.title).toBe('Intro to Programming');
  });

  it('still returns class details when persistence throws', async () => {
    mockGetServiceClient.mockImplementationOnce(() => {
      throw new Error('service client unavailable');
    });

    const response = await POST(request({ term: '2261', class_nbr: '12345' }));
    const data = await json(response);

    expect(response.status).toBe(200);
    expect(data.meeting_times).toBe('MWF 9:00 AM-9:50 AM');
    expect(mockGetServiceClient).toHaveBeenCalledTimes(1);
    expect(mockUpsert).not.toHaveBeenCalled();
  });
});
