import { vi } from 'vitest';

// Mock response builder for Supabase queries
export interface MockSupabaseResponse<T> {
  data: T | null;
  error: { message: string; code: string } | null;
}

// Create a chainable mock for Supabase client
export function createMockSupabaseClient() {
  const mockChain = {
    data: null as unknown,
    error: null as { message: string; code: string } | null,

    from: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    upsert: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    neq: vi.fn().mockReturnThis(),
    gt: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    lt: vi.fn().mockReturnThis(),
    lte: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    contains: vi.fn().mockReturnThis(),
    or: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    range: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockImplementation(function (this: typeof mockChain) {
      return Promise.resolve({ data: this.data, error: this.error });
    }),
    single: vi.fn().mockImplementation(function (this: typeof mockChain) {
      return Promise.resolve({ data: this.data, error: this.error });
    }),
    execute: vi.fn().mockImplementation(function (this: typeof mockChain) {
      return Promise.resolve({ data: this.data, error: this.error });
    }),

    // RPC mock
    rpc: vi.fn().mockImplementation(function (this: typeof mockChain) {
      return Promise.resolve({ data: this.data, error: this.error });
    }),

    // Set mock response data
    setMockData(data: unknown) {
      this.data = data;
      return this;
    },

    // Set mock error
    setMockError(error: { message: string; code: string } | null) {
      this.error = error;
      return this;
    },

    // Reset all mocks
    reset() {
      this.data = null;
      this.error = null;
      vi.clearAllMocks();
    },
  };

  return mockChain;
}

// Create mock for getServiceClient
export function createMockGetServiceClient() {
  const mockClient = createMockSupabaseClient();
  return {
    getServiceClient: vi.fn(() => mockClient),
    mockClient,
  };
}

// Common test data generators
export const mockFailedLoginAttempt = (overrides = {}) => ({
  email: 'test@example.com',
  attempts: 1,
  last_attempt_at: new Date().toISOString(),
  locked_until: null,
  ...overrides,
});

export const mockClassWatch = (overrides = {}) => ({
  id: 'watch-1',
  user_id: 'user-1',
  class_nbr: '12345',
  term: '2251',
  created_at: new Date().toISOString(),
  ...overrides,
});

export const mockClassState = (overrides = {}) => ({
  class_nbr: '12345',
  term: '2251',
  subject: 'CSE',
  catalog_number: '110',
  title: 'Intro to Programming',
  instructor: 'John Doe',
  total_seats: 50,
  open_seats: 10,
  waitlist_seats: 0,
  last_checked_at: new Date().toISOString(),
  ...overrides,
});

export const mockUserProfile = (overrides = {}) => ({
  id: 'profile-1',
  user_id: 'user-1',
  is_admin: false,
  notifications_enabled: true,
  created_at: new Date().toISOString(),
  ...overrides,
});
