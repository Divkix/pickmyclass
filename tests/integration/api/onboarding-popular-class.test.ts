import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import { GET } from '@/app/api/onboarding/popular-class/route';

const {
  mockGetUser,
  mockCreateClient,
  mockGetMostWatchedClass,
  mockFetchClassFromASU,
  mockGetSelectableTerms,
} = vi.hoisted(() => ({
  mockGetUser: vi.fn(),
  mockCreateClient: vi.fn(),
  mockGetMostWatchedClass: vi.fn(),
  mockFetchClassFromASU: vi.fn(),
  mockGetSelectableTerms: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: mockCreateClient,
}));

vi.mock('@/lib/db/queries', () => ({
  getMostWatchedClass: (...args: unknown[]) => mockGetMostWatchedClass(...args),
}));

vi.mock('@/lib/asu/api', () => ({
  fetchClassFromASU: (...args: unknown[]) => mockFetchClassFromASU(...args),
  NotFoundError: class NotFoundError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'NotFoundError';
    }
  },
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

const user = { id: 'user-123', email: 'student@example.com' };

const classDetails = {
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

async function json(response: Response) {
  return response.json() as Promise<Record<string, unknown>>;
}

describe('/api/onboarding/popular-class', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockCreateClient.mockResolvedValue({
      auth: { getUser: mockGetUser },
    });
    mockGetUser.mockResolvedValue({ data: { user }, error: null });
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  it('rejects unauthenticated requests', async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null }, error: { message: 'no session' } });
    mockGetSelectableTerms.mockReturnValue([{ code: '2267' }]);

    const response = await GET();
    const data = await json(response);

    expect(response.status).toBe(401);
    expect(data.error).toBe('Unauthorized');
    expect(mockGetMostWatchedClass).not.toHaveBeenCalled();
  });

  it('returns popularClass=null when no term is selectable', async () => {
    mockGetSelectableTerms.mockReturnValue([]);

    const response = await GET();
    const data = await json(response);

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.popularClass).toBeNull();
    expect(mockGetMostWatchedClass).not.toHaveBeenCalled();
  });

  it('returns popularClass=null when no popular class exists', async () => {
    mockGetSelectableTerms.mockReturnValue([{ code: '2267' }]);
    mockGetMostWatchedClass.mockResolvedValue(null);

    const response = await GET();
    const data = await json(response);

    expect(response.status).toBe(200);
    expect(data.popularClass).toBeNull();
    expect(mockGetMostWatchedClass).toHaveBeenCalledWith('2267');
    expect(mockFetchClassFromASU).not.toHaveBeenCalled();
  });

  it('returns the validated popular class with ASU details', async () => {
    mockGetSelectableTerms.mockReturnValue([{ code: '2267' }]);
    mockGetMostWatchedClass.mockResolvedValue({ class_nbr: '12345', term: '2267' });
    mockFetchClassFromASU.mockResolvedValue(classDetails);

    const response = await GET();
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
    mockGetSelectableTerms.mockReturnValue([{ code: '2267' }]);
    mockGetMostWatchedClass.mockResolvedValue({ class_nbr: '12345', term: '2267' });
    mockFetchClassFromASU.mockRejectedValue(
      Object.assign(new Error('Section 12345 not found'), { name: 'NotFoundError' })
    );

    const response = await GET();
    const data = await json(response);

    expect(response.status).toBe(200);
    expect(data.popularClass).toBeNull();
  });

  it('fails open to popularClass=null on a generic ASU API error', async () => {
    mockGetSelectableTerms.mockReturnValue([{ code: '2267' }]);
    mockGetMostWatchedClass.mockResolvedValue({ class_nbr: '12345', term: '2267' });
    mockFetchClassFromASU.mockRejectedValue(new Error('ASU API returned 500'));

    const response = await GET();
    const data = await json(response);

    expect(response.status).toBe(200);
    expect(data.popularClass).toBeNull();
  });

  it('fails open to popularClass=null when getMostWatchedClass throws', async () => {
    mockGetSelectableTerms.mockReturnValue([{ code: '2267' }]);
    mockGetMostWatchedClass.mockRejectedValue(new Error('db down'));

    const response = await GET();
    const data = await json(response);

    expect(response.status).toBe(200);
    expect(data.popularClass).toBeNull();
  });
});
