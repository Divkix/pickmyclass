import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { GET } from '@/app/api/monitoring/health/route'
import { createMockSupabaseClient } from '../../../mocks/supabase'
import { CircuitBreaker, CircuitState } from '@/lib/utils/circuit-breaker'

// Mock dependencies
vi.mock('@/lib/supabase/service')
vi.mock('@/lib/utils/circuit-breaker')

describe('Health Monitoring API', () => {
  let mockCircuitBreaker: CircuitBreaker

  beforeEach(() => {
    // Mock environment variables
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co'
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key'
    process.env.SCRAPER_URL = 'http://localhost:3000'
    process.env.SCRAPER_SECRET_TOKEN = 'test-token'
    process.env.CRON_SECRET = 'test-cron-secret'
    process.env.RESEND_API_KEY = 'test-resend-key'

    // Mock circuit breaker
    mockCircuitBreaker = new CircuitBreaker({ name: 'test' })
    const { getScraperCircuitBreaker } = vi.mocked(await import('@/lib/utils/circuit-breaker'))
    getScraperCircuitBreaker.mockReturnValue(mockCircuitBreaker)
  })

  afterEach(() => {
    vi.clearAllMocks()
    // Clean up env vars
    delete process.env.NEXT_PUBLIC_SUPABASE_URL
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    delete process.env.SUPABASE_SERVICE_ROLE_KEY
    delete process.env.SCRAPER_URL
    delete process.env.SCRAPER_SECRET_TOKEN
    delete process.env.CRON_SECRET
    delete process.env.RESEND_API_KEY
  })

  describe('Overall Health Status', () => {
    it('should return 200 when all checks pass', async () => {
      const mockClient = createMockSupabaseClient({
        queryData: new Map([['class_watches', [{ id: '123' }]]]),
      })
      const { getServiceClient } = vi.mocked(await import('@/lib/supabase/service'))
      getServiceClient.mockReturnValue(mockClient as any)

      const response = await GET()
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.status).toBe('healthy')
    })

    it('should return 503 when system is degraded', async () => {
      const mockClient = createMockSupabaseClient({
        queryData: new Map([['class_watches', [{ id: '123' }]]]),
      })
      const { getServiceClient } = vi.mocked(await import('@/lib/supabase/service'))
      getServiceClient.mockReturnValue(mockClient as any)

      // Mock circuit breaker in OPEN state
      vi.spyOn(mockCircuitBreaker, 'getStatus').mockReturnValue({
        name: 'ASU-Scraper',
        state: CircuitState.OPEN,
        failureCount: 10,
        successCount: 0,
        lastFailureTime: Date.now(),
      })

      const response = await GET()
      const data = await response.json()

      expect(response.status).toBe(503)
      expect(data.status).toBe('degraded')
    })

    it('should return 500 when system is unhealthy', async () => {
      // Missing required env vars
      delete process.env.SUPABASE_SERVICE_ROLE_KEY

      const mockClient = createMockSupabaseClient({
        queryData: new Map([['class_watches', [{ id: '123' }]]]),
      })
      const { getServiceClient } = vi.mocked(await import('@/lib/supabase/service'))
      getServiceClient.mockReturnValue(mockClient as any)

      const response = await GET()
      const data = await response.json()

      expect(response.status).toBe(500)
      expect(data.status).toBe('unhealthy')
    })
  })

  describe('Database Check', () => {
    it('should report healthy database connection', async () => {
      const mockClient = createMockSupabaseClient({
        queryData: new Map([['class_watches', [{ id: '123' }]]]),
      })
      const { getServiceClient } = vi.mocked(await import('@/lib/supabase/service'))
      getServiceClient.mockReturnValue(mockClient as any)

      const response = await GET()
      const data = await response.json()

      expect(data.checks.database).toMatchObject({
        status: 'healthy',
        latency_ms: expect.any(Number),
      })
    })

    it('should report unhealthy database on connection error', async () => {
      const mockClient = createMockSupabaseClient({
        queryErrors: new Map([['class_watches', new Error('Connection failed')]]),
      })
      const { getServiceClient } = vi.mocked(await import('@/lib/supabase/service'))
      getServiceClient.mockReturnValue(mockClient as any)

      const response = await GET()
      const data = await response.json()

      expect(data.checks.database).toMatchObject({
        status: 'unhealthy',
        error: expect.stringContaining('Connection failed'),
      })
      expect(data.status).toBe('degraded')
    })

    it('should measure database latency', async () => {
      const mockClient = createMockSupabaseClient({
        queryData: new Map([['class_watches', [{ id: '123' }]]]),
      })
      const { getServiceClient } = vi.mocked(await import('@/lib/supabase/service'))
      getServiceClient.mockReturnValue(mockClient as any)

      const response = await GET()
      const data = await response.json()

      expect(data.checks.database.latency_ms).toBeGreaterThanOrEqual(0)
    })
  })

  describe('Scraper Circuit Breaker Check', () => {
    it('should report healthy when circuit is CLOSED', async () => {
      const mockClient = createMockSupabaseClient({
        queryData: new Map([['class_watches', [{ id: '123' }]]]),
      })
      const { getServiceClient } = vi.mocked(await import('@/lib/supabase/service'))
      getServiceClient.mockReturnValue(mockClient as any)

      vi.spyOn(mockCircuitBreaker, 'getStatus').mockReturnValue({
        name: 'ASU-Scraper',
        state: CircuitState.CLOSED,
        failureCount: 0,
        successCount: 0,
        lastFailureTime: null,
      })

      const response = await GET()
      const data = await response.json()

      expect(data.checks.scraper.status).toBe('healthy')
      expect(data.checks.scraper.circuit_breaker.state).toBe('CLOSED')
    })

    it('should report degraded when circuit is HALF_OPEN', async () => {
      const mockClient = createMockSupabaseClient({
        queryData: new Map([['class_watches', [{ id: '123' }]]]),
      })
      const { getServiceClient } = vi.mocked(await import('@/lib/supabase/service'))
      getServiceClient.mockReturnValue(mockClient as any)

      vi.spyOn(mockCircuitBreaker, 'getStatus').mockReturnValue({
        name: 'ASU-Scraper',
        state: CircuitState.HALF_OPEN,
        failureCount: 5,
        successCount: 1,
        lastFailureTime: Date.now(),
      })

      const response = await GET()
      const data = await response.json()

      expect(data.checks.scraper.status).toBe('degraded')
      expect(data.checks.scraper.circuit_breaker.state).toBe('HALF_OPEN')
    })

    it('should report unhealthy when circuit is OPEN', async () => {
      const mockClient = createMockSupabaseClient({
        queryData: new Map([['class_watches', [{ id: '123' }]]]),
      })
      const { getServiceClient } = vi.mocked(await import('@/lib/supabase/service'))
      getServiceClient.mockReturnValue(mockClient as any)

      vi.spyOn(mockCircuitBreaker, 'getStatus').mockReturnValue({
        name: 'ASU-Scraper',
        state: CircuitState.OPEN,
        failureCount: 10,
        successCount: 0,
        lastFailureTime: Date.now(),
      })

      const response = await GET()
      const data = await response.json()

      expect(data.checks.scraper.status).toBe('unhealthy')
      expect(data.checks.scraper.circuit_breaker.state).toBe('OPEN')
      expect(data.status).toBe('degraded')
    })

    it('should include circuit breaker metrics', async () => {
      const mockClient = createMockSupabaseClient({
        queryData: new Map([['class_watches', [{ id: '123' }]]]),
      })
      const { getServiceClient } = vi.mocked(await import('@/lib/supabase/service'))
      getServiceClient.mockReturnValue(mockClient as any)

      const lastFailure = Date.now()
      vi.spyOn(mockCircuitBreaker, 'getStatus').mockReturnValue({
        name: 'ASU-Scraper',
        state: CircuitState.OPEN,
        failureCount: 10,
        successCount: 0,
        lastFailureTime: lastFailure,
      })

      const response = await GET()
      const data = await response.json()

      expect(data.checks.scraper.circuit_breaker).toMatchObject({
        state: 'OPEN',
        failure_count: 10,
        success_count: 0,
        last_failure: new Date(lastFailure).toISOString(),
      })
    })
  })

  describe('Configuration Check', () => {
    it('should report healthy when all required env vars present', async () => {
      const mockClient = createMockSupabaseClient({
        queryData: new Map([['class_watches', [{ id: '123' }]]]),
      })
      const { getServiceClient } = vi.mocked(await import('@/lib/supabase/service'))
      getServiceClient.mockReturnValue(mockClient as any)

      const response = await GET()
      const data = await response.json()

      expect(data.checks.configuration.status).toBe('healthy')
      expect(data.checks.configuration.missing_vars).toBeUndefined()
    })

    it('should report unhealthy and list missing env vars', async () => {
      delete process.env.SUPABASE_SERVICE_ROLE_KEY
      delete process.env.SCRAPER_SECRET_TOKEN

      const mockClient = createMockSupabaseClient({
        queryData: new Map([['class_watches', [{ id: '123' }]]]),
      })
      const { getServiceClient } = vi.mocked(await import('@/lib/supabase/service'))
      getServiceClient.mockReturnValue(mockClient as any)

      const response = await GET()
      const data = await response.json()

      expect(data.checks.configuration.status).toBe('unhealthy')
      expect(data.checks.configuration.missing_vars).toContain('SUPABASE_SERVICE_ROLE_KEY')
      expect(data.checks.configuration.missing_vars).toContain('SCRAPER_SECRET_TOKEN')
      expect(data.status).toBe('unhealthy')
    })
  })

  describe('Email Service Check', () => {
    it('should report healthy when Resend API key is configured', async () => {
      const mockClient = createMockSupabaseClient({
        queryData: new Map([['class_watches', [{ id: '123' }]]]),
      })
      const { getServiceClient } = vi.mocked(await import('@/lib/supabase/service'))
      getServiceClient.mockReturnValue(mockClient as any)

      const response = await GET()
      const data = await response.json()

      expect(data.checks.email).toMatchObject({
        status: 'healthy',
        configured: true,
      })
    })

    it('should report not_configured when Resend API key missing', async () => {
      delete process.env.RESEND_API_KEY

      const mockClient = createMockSupabaseClient({
        queryData: new Map([['class_watches', [{ id: '123' }]]]),
      })
      const { getServiceClient } = vi.mocked(await import('@/lib/supabase/service'))
      getServiceClient.mockReturnValue(mockClient as any)

      const response = await GET()
      const data = await response.json()

      expect(data.checks.email).toMatchObject({
        status: 'not_configured',
        configured: false,
      })
    })
  })

  describe('Response Format', () => {
    it('should include timestamp in ISO format', async () => {
      const mockClient = createMockSupabaseClient({
        queryData: new Map([['class_watches', [{ id: '123' }]]]),
      })
      const { getServiceClient } = vi.mocked(await import('@/lib/supabase/service'))
      getServiceClient.mockReturnValue(mockClient as any)

      const response = await GET()
      const data = await response.json()

      expect(data.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/)
      expect(new Date(data.timestamp).toISOString()).toBe(data.timestamp)
    })

    it('should include response time', async () => {
      const mockClient = createMockSupabaseClient({
        queryData: new Map([['class_watches', [{ id: '123' }]]]),
      })
      const { getServiceClient } = vi.mocked(await import('@/lib/supabase/service'))
      getServiceClient.mockReturnValue(mockClient as any)

      const response = await GET()
      const data = await response.json()

      expect(data.response_time_ms).toBeDefined()
      expect(data.response_time_ms).toBeGreaterThanOrEqual(0)
    })

    it('should include all check categories', async () => {
      const mockClient = createMockSupabaseClient({
        queryData: new Map([['class_watches', [{ id: '123' }]]]),
      })
      const { getServiceClient } = vi.mocked(await import('@/lib/supabase/service'))
      getServiceClient.mockReturnValue(mockClient as any)

      const response = await GET()
      const data = await response.json()

      expect(data.checks).toHaveProperty('database')
      expect(data.checks).toHaveProperty('scraper')
      expect(data.checks).toHaveProperty('configuration')
      expect(data.checks).toHaveProperty('email')
    })
  })
})
