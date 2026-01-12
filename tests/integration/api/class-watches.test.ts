import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DELETE, GET, POST } from '@/app/api/class-watches/route';

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
  error?: string;
}

interface PostResponse {
  watch?: ClassWatch;
  error?: string;
  details?: Array<{ field: string; message: string }>;
}

interface DeleteResponse {
  success?: boolean;
  error?: string;
  details?: Array<{ field: string; message: string }>;
}

// Mock data
const mockUser = { id: 'user-123', email: 'test@example.com' };
const mockWatch: ClassWatch = {
  id: 'watch-1',
  user_id: 'user-123',
  term: '2261',
  subject: 'CSE',
  catalog_nbr: '240',
  class_nbr: '12345',
  created_at: '2024-06-15T12:00:00Z',
};
const mockClassState: ClassState = {
  class_nbr: '12345',
  term: '2261',
  subject: 'CSE',
  catalog_nbr: '240',
  title: 'Intro to Programming',
  instructor_name: 'John Doe',
  seats_available: 10,
  seats_capacity: 50,
};

// Mock Supabase methods
const mockGetUser = vi.fn();
const mockFrom = vi.fn();
const mockSelect = vi.fn();
const mockInsert = vi.fn();
const mockDelete = vi.fn();
const mockEq = vi.fn();
const mockIn = vi.fn();
const mockOrder = vi.fn();
const mockSingle = vi.fn();
const mockUpsert = vi.fn();

// Mock for delete with double eq chain
const mockDeleteEqChain = vi.fn();

// Setup mock chain
const setupMockChain = () => {
  mockFrom.mockReturnValue({
    select: mockSelect,
    insert: mockInsert,
    delete: mockDelete,
    upsert: mockUpsert,
  });
  mockSelect.mockReturnValue({
    eq: mockEq,
    in: mockIn,
    order: mockOrder,
  });
  mockEq.mockReturnValue({
    eq: mockEq,
    order: mockOrder,
    single: mockSingle,
  });
  mockOrder.mockReturnValue(Promise.resolve({ data: [], error: null }));
  mockIn.mockReturnValue(Promise.resolve({ data: [], error: null }));
  mockInsert.mockReturnValue({
    select: mockSelect,
  });
  // Delete chain: .delete().eq(id).eq(user_id)
  mockDeleteEqChain.mockResolvedValue({ error: null });
  mockDelete.mockReturnValue({
    eq: vi.fn().mockReturnValue({
      eq: mockDeleteEqChain,
    }),
  });
};

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() =>
    Promise.resolve({
      auth: {
        getUser: mockGetUser,
      },
      from: mockFrom,
    })
  ),
}));

vi.mock('@/lib/supabase/service', () => ({
  getServiceClient: vi.fn(() => ({
    from: vi.fn().mockReturnValue({
      upsert: vi.fn().mockResolvedValue({ error: null }),
    }),
  })),
}));

// Mock fetch for scraper calls
global.fetch = vi.fn();

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
    vi.clearAllMocks();
    setupMockChain();
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
    });

    it('should return watches with joined class states', async () => {
      mockGetUser.mockResolvedValue({ data: { user: mockUser }, error: null });
      mockOrder.mockResolvedValue({ data: [mockWatch], error: null });
      mockIn.mockResolvedValue({ data: [mockClassState], error: null });

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

      const request = createRequest({ term: '2261', class_nbr: '12345' });
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

      const request = createRequest({ term: '2261', class_nbr: '123' });
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

      const request = createRequest({ term: '2261', class_nbr: '12345' });
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

      // Mock the insert chain to return unique constraint violation
      const mockInsertChain = {
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: null,
            error: { code: '23505', message: 'Unique constraint violation' },
          }),
        }),
      };
      mockInsert.mockReturnValue(mockInsertChain);

      const request = createRequest({ term: '2261', class_nbr: '12345' });
      const response = await POST(request);
      const data = await parsePostResponse(response);

      expect(response.status).toBe(409);
      expect(data.error).toBe('You are already watching this class');
    });

    it('should return 500 when scraper fails', async () => {
      mockGetUser.mockResolvedValue({ data: { user: mockUser }, error: null });
      mockSelect.mockReturnValueOnce({
        eq: vi.fn().mockResolvedValue({ count: 0, error: null }),
      });

      // Set env vars to trigger scraper call
      vi.stubEnv('SCRAPER_URL', 'https://scraper.test.com');
      vi.stubEnv('SCRAPER_SECRET_TOKEN', 'test-token');

      // Mock fetch to fail
      (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Network error'));

      const request = createRequest({ term: '2261', class_nbr: '12345' });
      const response = await POST(request);
      const data = await parsePostResponse(response);

      expect(response.status).toBe(500);
      expect(data.error).toContain('Failed to fetch class details');

      vi.unstubAllEnvs();
    });

    it('should create watch successfully with development fallback', async () => {
      mockGetUser.mockResolvedValue({ data: { user: mockUser }, error: null });
      mockSelect.mockReturnValueOnce({
        eq: vi.fn().mockResolvedValue({ count: 0, error: null }),
      });

      // Make sure SCRAPER_URL is not set for dev fallback
      vi.stubEnv('SCRAPER_URL', '');
      vi.stubEnv('SCRAPER_SECRET_TOKEN', '');

      // Mock the insert chain
      const mockInsertChain = {
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: mockWatch,
            error: null,
          }),
        }),
      };
      mockInsert.mockReturnValue(mockInsertChain);

      const request = createRequest({ term: '2261', class_nbr: '12345' });
      const response = await POST(request);
      const data = await parsePostResponse(response);

      expect(response.status).toBe(201);
      expect(data.watch).toBeDefined();

      vi.unstubAllEnvs();
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
