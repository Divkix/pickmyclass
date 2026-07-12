import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import { DELETE, GET, POST } from '@/app/api/class-watches/route';
import type { ValidationIssueDetail } from '@/lib/api/validation';

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

// Mock Supabase methods
const mockGetUser = vi.fn();
const mockFrom = vi.fn();
const mockRpc = vi.fn();
const mockSelect = vi.fn();
const mockDelete = vi.fn();
const mockEq = vi.fn();
const mockIn = vi.fn();
const mockOrder = vi.fn();
const mockMaybeSingle = vi.fn();
const mockUpsert = vi.fn();
const mockServiceFrom = vi.fn();
const mockServiceUpsert = vi.fn();
const mockServiceUpdate = vi.fn();

// Mock for delete with double eq chain
const mockDeleteEqChain = vi.fn();

// Onboarding-complete update chain on the service client:
// .update(...).eq('user_id').is('onboarding_completed_at', null)
const mockServiceOnboardingUpdateEq = vi.fn();
const mockServiceOnboardingIs = vi.fn();

// Setup mock chain
const setupMockChain = () => {
  mockFrom.mockReturnValue({
    select: mockSelect,
    delete: mockDelete,
    upsert: mockUpsert,
  });
  mockSelect.mockReturnValue({
    eq: mockEq,
    in: mockIn,
    order: mockOrder,
  });
  // Shared eq chain supports both .order() (class_watches) and .maybeSingle() (user_profiles).
  mockEq.mockReturnValue({
    eq: mockEq,
    order: mockOrder,
    maybeSingle: mockMaybeSingle,
  });
  mockOrder.mockReturnValue(Promise.resolve({ data: [], error: null }));
  mockMaybeSingle.mockResolvedValue({
    data: { onboarding_completed_at: '2026-01-01T00:00:00Z', onboarding_skipped_at: null },
    error: null,
  });
  mockIn.mockImplementation(() => {
    const p = Promise.resolve({ data: [], error: null }) as any;
    p.in = () => p;
    return p;
  });
  // Delete chain: .delete().eq(id).eq(user_id)
  mockDeleteEqChain.mockResolvedValue({ error: null });
  mockDelete.mockReturnValue({
    eq: vi.fn().mockReturnValue({
      eq: mockDeleteEqChain,
    }),
  });
  // Service client: upsert (class state) + update (onboarding completion).
  // Onboarding-complete update chain on the service client:
  // .update(...).eq('user_id').is('onboarding_completed_at', null)
  // (issue #307: the guard only filters completed_at, NOT skipped_at, so a
  // skipped user still completes on their first watch.)
  const onboardingIsChain = Promise.resolve({ error: null }) as any;
  onboardingIsChain.is = mockServiceOnboardingIs;
  mockServiceOnboardingIs.mockReturnValue(onboardingIsChain);
  mockServiceOnboardingUpdateEq.mockReturnValue({ is: mockServiceOnboardingIs });
  mockServiceUpdate.mockReturnValue({ eq: mockServiceOnboardingUpdateEq });
  mockServiceFrom.mockReturnValue({
    upsert: mockServiceUpsert,
    update: mockServiceUpdate,
  });
  mockServiceUpsert.mockResolvedValue({ error: null });
};

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() =>
    Promise.resolve({
      auth: {
        getUser: mockGetUser,
      },
      from: mockFrom,
      rpc: mockRpc,
    })
  ),
}));

vi.mock('@/lib/supabase/service', () => ({
  getServiceClient: vi.fn(() => ({
    from: mockServiceFrom,
    rpc: mockRpc,
  })),
}));

// Mock ASU API client
const mockFetchClassFromASU = vi.fn();
vi.mock('@/lib/asu/api', () => ({
  fetchClassFromASU: (...args: unknown[]) => mockFetchClassFromASU(...args),
  NotFoundError: class NotFoundError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'NotFoundError';
    }
  },
  AuthError: class AuthError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'AuthError';
    }
  },
}));

// Mock cloudflare:workers for env import
vi.mock('cloudflare:workers', () => ({
  env: {
    ASU_API_BASE_URL: 'https://mock-asu-api.example.com',
    ASU_API_TOKEN: 'mock-token',
  },
}));

// Response parsers
async function parseGetResponse(response: Response): Promise<GetResponse> {
  return (await response.json()) as GetResponse;
}

async function parsePostResponse(response: Response): Promise<PostResponse> {
  return (await response.json()) as PostResponse;
}

async function parseDeleteResponse(response: Response): Promise<DeleteResponse> {
  return (await response.json()) as DeleteResponse;
}

describe('/api/class-watches', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-15T12:00:00Z'));
    vi.clearAllMocks();
    setupMockChain();
    mockRpc.mockResolvedValue({ data: mockWatch, error: null });
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
      mockGetUser.mockResolvedValue({ data: { user: mockUser }, error: null });
      mockOrder.mockResolvedValue({ data: [], error: null });

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
      mockGetUser.mockResolvedValue({ data: { user: mockUser }, error: null });
      mockOrder.mockResolvedValue({ data: [mockWatch], error: null });
      mockIn.mockImplementation(() => {
        const p = Promise.resolve({ data: [mockClassState], error: null }) as any;
        p.in = () => p;
        return p;
      });

      const response = await GET();
      const data = await parseGetResponse(response);

      expect(response.status).toBe(200);
      expect(data.watches).toHaveLength(1);
      expect(data.watches?.[0].class_state).toEqual(mockClassState);
    });

    it('should handle database errors', async () => {
      mockGetUser.mockResolvedValue({ data: { user: mockUser }, error: null });
      mockOrder.mockResolvedValue({ data: null, error: { message: 'Database error' } });

      const response = await GET();
      const data = await parseGetResponse(response);

      expect(response.status).toBe(500);
      expect(data.error).toBe('Failed to fetch class watches');
    });
  });

  describe('POST /api/class-watches', () => {
    const createRequest = (body: Record<string, unknown>): NextRequest => {
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
      mockGetUser.mockResolvedValue({ data: { user: mockUser }, error: null });
      mockSelect.mockReturnValueOnce({
        eq: vi.fn().mockResolvedValue({ count: 0, error: null }),
      });

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
      mockGetUser.mockResolvedValue({ data: { user: mockUser }, error: null });
      mockSelect.mockReturnValueOnce({
        eq: vi.fn().mockResolvedValue({ count: 0, error: null }),
      });

      const request = createRequest({ term: '2264', class_nbr: '123' });
      const response = await POST(request);
      const data = await parsePostResponse(response);

      expect(response.status).toBe(400);
      expect(data.error).toBe('Invalid input');
    });

    it('should return 429 when max watches limit reached', async () => {
      mockGetUser.mockResolvedValue({ data: { user: mockUser }, error: null });
      // Mock select to return count: 10 (at limit)
      mockSelect.mockReturnValueOnce({
        eq: vi.fn().mockResolvedValue({ count: 10, error: null }),
      });

      const request = createRequest({ term: '2264', class_nbr: '12345' });
      const response = await POST(request);
      const data = await parsePostResponse(response);

      expect(response.status).toBe(429);
      expect(data.error).toContain('Maximum watches limit reached');
    });

    it('should return 409 for duplicate watch', async () => {
      mockGetUser.mockResolvedValue({ data: { user: mockUser }, error: null });
      mockSelect.mockReturnValueOnce({
        eq: vi.fn().mockResolvedValue({ count: 0, error: null }),
      });
      mockFetchClassFromASU.mockResolvedValue(mockClassDetails);
      mockRpc.mockResolvedValue({
        data: null,
        error: { code: '23505', message: 'Unique constraint violation' },
      });

      const request = createRequest({ term: '2264', class_nbr: '12345' });
      const response = await POST(request);
      const data = await parsePostResponse(response);

      expect(response.status).toBe(409);
      expect(data.error).toBe('You are already watching this class');
    });

    it('should return 429 when atomic insert reports limit exceeded', async () => {
      mockGetUser.mockResolvedValue({ data: { user: mockUser }, error: null });
      mockSelect.mockReturnValueOnce({
        eq: vi.fn().mockResolvedValue({ count: 0, error: null }),
      });
      mockFetchClassFromASU.mockResolvedValue(mockClassDetails);
      mockRpc.mockResolvedValue({
        data: null,
        error: { code: 'P0001', message: 'MAX_WATCHES_EXCEEDED' },
      });

      const request = createRequest({ term: '2264', class_nbr: '12345' });
      const response = await POST(request);
      const data = await parsePostResponse(response);

      expect(response.status).toBe(429);
      expect(data.error).toContain('Maximum watches limit reached');
    });

    it('should return 500 when ASU API fetch fails', async () => {
      mockGetUser.mockResolvedValue({ data: { user: mockUser }, error: null });
      mockSelect.mockReturnValueOnce({
        eq: vi.fn().mockResolvedValue({ count: 0, error: null }),
      });

      mockFetchClassFromASU.mockRejectedValue(new Error('Network error'));

      const request = createRequest({ term: '2264', class_nbr: '12345' });
      const response = await POST(request);
      const data = await parsePostResponse(response);

      expect(response.status).toBe(500);
      expect(data.error).toBe('Failed to fetch class details');
    });

    it('should return 404 when class section not found', async () => {
      mockGetUser.mockResolvedValue({ data: { user: mockUser }, error: null });
      mockSelect.mockReturnValueOnce({
        eq: vi.fn().mockResolvedValue({ count: 0, error: null }),
      });

      // Import the mock class to throw the right error type
      const { NotFoundError } = await import('@/lib/asu/api');
      mockFetchClassFromASU.mockRejectedValue(new NotFoundError('Section 99999 not found'));

      const request = createRequest({ term: '2264', class_nbr: '99999' });
      const response = await POST(request);
      const data = await parsePostResponse(response);

      expect(response.status).toBe(404);
      expect(data.error).toBe('Class section not found');
    });

    it('should return 503 when ASU API auth fails', async () => {
      mockGetUser.mockResolvedValue({ data: { user: mockUser }, error: null });
      mockSelect.mockReturnValueOnce({
        eq: vi.fn().mockResolvedValue({ count: 0, error: null }),
      });

      const { AuthError } = await import('@/lib/asu/api');
      mockFetchClassFromASU.mockRejectedValue(new AuthError('Token expired'));

      const request = createRequest({ term: '2264', class_nbr: '12345' });
      const response = await POST(request);
      const data = await parsePostResponse(response);

      expect(response.status).toBe(503);
      expect(data.error).toBe('Service temporarily unavailable');
    });

    it('should create watch successfully with ASU API data', async () => {
      mockGetUser.mockResolvedValue({ data: { user: mockUser }, error: null });
      mockSelect.mockReturnValueOnce({
        eq: vi.fn().mockResolvedValue({ count: 0, error: null }),
      });

      mockFetchClassFromASU.mockResolvedValue(mockClassDetails);
      mockRpc.mockResolvedValue({ data: mockWatch, error: null });

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
      expect(mockRpc).toHaveBeenCalledWith(
        'create_class_watch_with_limit',
        expect.objectContaining({
          p_user_id: mockUser.id,
          p_term: '2264',
          p_class_nbr: '12345',
        })
      );
      expect(mockServiceUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          class_nbr: '12345',
          term: '2264',
          last_checked_at: expect.any(String),
        }),
        { onConflict: 'class_nbr,term' }
      );
      // Onboarding is marked complete on the user's first watch.
      expect(mockServiceUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ onboarding_completed_at: expect.any(String) })
      );
      expect(mockServiceOnboardingUpdateEq).toHaveBeenCalledWith('user_id', mockUser.id);
      // Issue #307: completion guard filters ONLY on onboarding_completed_at,
      // not on onboarding_skipped_at, so a skipped user still completes.
      expect(mockServiceOnboardingIs).toHaveBeenCalledWith('onboarding_completed_at', null);
      expect(mockServiceOnboardingIs).not.toHaveBeenCalledWith('onboarding_skipped_at', null);
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
      mockGetUser.mockResolvedValue({ data: { user: mockUser }, error: null });

      const request = createDeleteRequest('not-a-uuid');
      const response = await DELETE(request);
      const data = await parseDeleteResponse(response);

      expect(response.status).toBe(400);
      expect(data.error).toBe('Invalid input');
    });

    it('should return 400 for missing ID', async () => {
      mockGetUser.mockResolvedValue({ data: { user: mockUser }, error: null });

      const request = createDeleteRequest(null);
      const response = await DELETE(request);

      expect(response.status).toBe(400);
    });

    it('should delete watch successfully', async () => {
      mockGetUser.mockResolvedValue({ data: { user: mockUser }, error: null });
      mockDeleteEqChain.mockResolvedValue({ error: null });

      const request = createDeleteRequest('550e8400-e29b-41d4-a716-446655440000');
      const response = await DELETE(request);
      const data = await parseDeleteResponse(response);

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
    });

    it('should handle database errors on delete', async () => {
      mockGetUser.mockResolvedValue({ data: { user: mockUser }, error: null });
      mockDeleteEqChain.mockResolvedValue({ error: { message: 'Database error' } });

      const request = createDeleteRequest('550e8400-e29b-41d4-a716-446655440000');
      const response = await DELETE(request);
      const data = await parseDeleteResponse(response);

      expect(response.status).toBe(500);
      expect(data.error).toBe('Failed to delete class watch');
    });
  });
});
