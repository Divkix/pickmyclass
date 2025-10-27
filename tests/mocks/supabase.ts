import { vi } from 'vitest'

/**
 * Mock Supabase query builder with chainable methods
 */
class MockQueryBuilder {
  private data: unknown[] = []
  private error: unknown = null
  private singleResult = false

  constructor(data: unknown[] = [], error: unknown = null) {
    this.data = data
    this.error = error
  }

  select(columns?: string) {
    vi.fn()(columns)
    return this
  }

  insert(values: unknown) {
    vi.fn()(values)
    return this
  }

  update(values: unknown) {
    vi.fn()(values)
    return this
  }

  delete() {
    vi.fn()()
    return this
  }

  eq(column: string, value: unknown) {
    vi.fn()(column, value)
    return this
  }

  neq(column: string, value: unknown) {
    vi.fn()(column, value)
    return this
  }

  in(column: string, values: unknown[]) {
    vi.fn()(column, values)
    return this
  }

  is(column: string, value: unknown) {
    vi.fn()(column, value)
    return this
  }

  single() {
    this.singleResult = true
    return this
  }

  order(column: string, options?: { ascending?: boolean }) {
    vi.fn()(column, options)
    return this
  }

  limit(count: number) {
    vi.fn()(count)
    return this
  }

  /**
   * Execute query and return result
   */
  async then(
    resolve: (value: { data: unknown; error: unknown }) => void
  ): Promise<{ data: unknown; error: unknown }> {
    const result = {
      data: this.singleResult ? this.data[0] || null : this.data,
      error: this.error,
    }
    resolve(result)
    return result
  }
}

/**
 * Create mock Supabase client
 */
export function createMockSupabaseClient(config: {
  userData?: unknown
  authError?: unknown
  queryData?: Map<string, unknown[]>
  queryErrors?: Map<string, unknown>
} = {}) {
  const {
    userData = null,
    authError = null,
    queryData = new Map(),
    queryErrors = new Map(),
  } = config

  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: userData },
        error: authError,
      }),
      getSession: vi.fn().mockResolvedValue({
        data: { session: userData ? { user: userData } : null },
        error: authError,
      }),
      signOut: vi.fn().mockResolvedValue({ error: null }),
    },
    from: (table: string) => {
      const data = queryData.get(table) || []
      const error = queryErrors.get(table) || null
      return new MockQueryBuilder(data, error)
    },
    rpc: vi.fn((fnName: string, params?: unknown) => {
      const data = queryData.get(`rpc:${fnName}`) || []
      const error = queryErrors.get(`rpc:${fnName}`) || null
      return new MockQueryBuilder(data, error)
    }),
  }
}

/**
 * Mock auth helper that returns user
 */
export function mockAuthUser(overrides = {}) {
  return {
    id: 'test-user-id',
    email: 'test@example.com',
    created_at: new Date().toISOString(),
    ...overrides,
  }
}
