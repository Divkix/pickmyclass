import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { GET } from '@/app/api/cron/route'
import { createMockRequest, createMockEnv } from '../../setup/test-utils'
import { MockQueue } from '../../mocks/cloudflare-env'
import { createMockSupabaseClient } from '../../mocks/supabase'

// Mock dependencies
vi.mock('@/lib/db/queries')
vi.mock('@opennextjs/cloudflare')
vi.mock('@/lib/supabase/service')

describe('Cron API Route', () => {
  let mockQueue: MockQueue
  let mockEnv: ReturnType<typeof createMockEnv>

  beforeEach(() => {
    mockQueue = new MockQueue()
    mockEnv = createMockEnv({ CLASS_CHECK_QUEUE: mockQueue })

    // Mock process.env
    process.env.CRON_SECRET = 'test-cron-secret'

    // Mock Cloudflare context
    const { getCloudflareContext } = vi.mocked(await import('@opennextjs/cloudflare'))
    getCloudflareContext.mockResolvedValue({
      env: mockEnv,
      cf: {},
      ctx: {} as any,
    })

    // Mock Supabase client
    const mockClient = createMockSupabaseClient({
      queryData: new Map([['rpc:get_sections_to_check', []]]),
    })
    const { getServiceClient } = vi.mocked(await import('@/lib/supabase/service'))
    getServiceClient.mockReturnValue(mockClient as any)
  })

  afterEach(() => {
    vi.clearAllMocks()
    mockQueue.clear()
    delete process.env.CRON_SECRET
  })

  describe('Authentication', () => {
    it('should reject requests without Bearer token', async () => {
      const request = createMockRequest('http://localhost:3000/api/cron', {
        method: 'GET',
      })

      const response = await GET(request as any)
      const data = await response.json()

      expect(response.status).toBe(401)
      expect(data.success).toBe(false)
      expect(data.error).toContain('Unauthorized')
    })

    it('should reject requests with invalid Bearer token', async () => {
      const request = createMockRequest('http://localhost:3000/api/cron', {
        method: 'GET',
        headers: { Authorization: 'Bearer wrong-secret' },
      })

      const response = await GET(request as any)
      const data = await response.json()

      expect(response.status).toBe(401)
      expect(data.success).toBe(false)
    })

    it('should accept requests with valid Bearer token', async () => {
      const { getSectionsToCheck } = vi.mocked(await import('@/lib/db/queries'))
      getSectionsToCheck.mockResolvedValue([])

      const request = createMockRequest('http://localhost:3000/api/cron', {
        method: 'GET',
        headers: { Authorization: 'Bearer test-cron-secret' },
      })

      const response = await GET(request as any)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
    })

    it('should return 500 when CRON_SECRET not configured', async () => {
      delete process.env.CRON_SECRET

      const request = createMockRequest('http://localhost:3000/api/cron', {
        method: 'GET',
        headers: { Authorization: 'Bearer test-cron-secret' },
      })

      const response = await GET(request as any)
      const data = await response.json()

      expect(response.status).toBe(500)
      expect(data.error).toContain('Server configuration error')
    })
  })

  describe('Stagger Group Logic', () => {
    beforeEach(() => {
      // Mock Date to control current time
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('should use "even" stagger at :00 minutes', async () => {
      const { getSectionsToCheck } = vi.mocked(await import('@/lib/db/queries'))
      getSectionsToCheck.mockResolvedValue([])

      // Set time to 10:00
      vi.setSystemTime(new Date('2025-01-27T10:00:00Z'))

      const request = createMockRequest('http://localhost:3000/api/cron', {
        method: 'GET',
        headers: { Authorization: 'Bearer test-cron-secret' },
      })

      const response = await GET(request as any)
      const data = await response.json()

      expect(getSectionsToCheck).toHaveBeenCalledWith('even')
      expect(data.stagger_group).toBe('even')
    })

    it('should use "odd" stagger at :30 minutes', async () => {
      const { getSectionsToCheck } = vi.mocked(await import('@/lib/db/queries'))
      getSectionsToCheck.mockResolvedValue([])

      // Set time to 10:30
      vi.setSystemTime(new Date('2025-01-27T10:30:00Z'))

      const request = createMockRequest('http://localhost:3000/api/cron', {
        method: 'GET',
        headers: { Authorization: 'Bearer test-cron-secret' },
      })

      const response = await GET(request as any)
      const data = await response.json()

      expect(getSectionsToCheck).toHaveBeenCalledWith('odd')
      expect(data.stagger_group).toBe('odd')
    })
  })

  describe('Queue Enqueueing', () => {
    it('should enqueue all sections to queue', async () => {
      const mockSections = [
        { class_nbr: '12430', term: '2261' },
        { class_nbr: '12432', term: '2261' },
        { class_nbr: '12434', term: '2261' },
      ]

      const { getSectionsToCheck } = vi.mocked(await import('@/lib/db/queries'))
      getSectionsToCheck.mockResolvedValue(mockSections)

      const request = createMockRequest('http://localhost:3000/api/cron', {
        method: 'GET',
        headers: { Authorization: 'Bearer test-cron-secret' },
      })

      const response = await GET(request as any)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
      expect(data.sections_enqueued).toBe(3)
      expect(mockQueue.getMessages()).toHaveLength(3)
    })

    it('should include correct message format', async () => {
      const mockSections = [{ class_nbr: '12430', term: '2261' }]

      const { getSectionsToCheck } = vi.mocked(await import('@/lib/db/queries'))
      getSectionsToCheck.mockResolvedValue(mockSections)

      vi.setSystemTime(new Date('2025-01-27T10:00:00Z'))

      const request = createMockRequest('http://localhost:3000/api/cron', {
        method: 'GET',
        headers: { Authorization: 'Bearer test-cron-secret' },
      })

      await GET(request as any)

      const messages = mockQueue.getMessages()
      expect(messages[0]).toMatchObject({
        class_nbr: '12430',
        term: '2261',
        stagger_group: 'even',
      })
      expect(messages[0].enqueued_at).toBeDefined()
    })

    it('should handle empty sections list', async () => {
      const { getSectionsToCheck } = vi.mocked(await import('@/lib/db/queries'))
      getSectionsToCheck.mockResolvedValue([])

      const request = createMockRequest('http://localhost:3000/api/cron', {
        method: 'GET',
        headers: { Authorization: 'Bearer test-cron-secret' },
      })

      const response = await GET(request as any)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
      expect(data.sections_enqueued).toBe(0)
      expect(data.message).toContain('No sections to check')
      expect(mockQueue.getMessages()).toHaveLength(0)
    })
  })

  describe('Error Handling', () => {
    it('should return 500 when queue binding not found', async () => {
      const { getCloudflareContext } = vi.mocked(await import('@opennextjs/cloudflare'))
      getCloudflareContext.mockResolvedValue({
        env: { ...mockEnv, CLASS_CHECK_QUEUE: undefined } as any,
        cf: {},
        ctx: {} as any,
      })

      const request = createMockRequest('http://localhost:3000/api/cron', {
        method: 'GET',
        headers: { Authorization: 'Bearer test-cron-secret' },
      })

      const response = await GET(request as any)
      const data = await response.json()

      expect(response.status).toBe(500)
      expect(data.error).toContain('Queue binding not configured')
    })

    it('should return 500 when database query fails', async () => {
      const { getSectionsToCheck } = vi.mocked(await import('@/lib/db/queries'))
      getSectionsToCheck.mockRejectedValue(new Error('Database connection failed'))

      const request = createMockRequest('http://localhost:3000/api/cron', {
        method: 'GET',
        headers: { Authorization: 'Bearer test-cron-secret' },
      })

      const response = await GET(request as any)
      const data = await response.json()

      expect(response.status).toBe(500)
      expect(data.success).toBe(false)
      expect(data.error).toContain('Database connection failed')
    })

    it('should include duration in error response', async () => {
      const { getSectionsToCheck } = vi.mocked(await import('@/lib/db/queries'))
      getSectionsToCheck.mockRejectedValue(new Error('Test error'))

      const request = createMockRequest('http://localhost:3000/api/cron', {
        method: 'GET',
        headers: { Authorization: 'Bearer test-cron-secret' },
      })

      const response = await GET(request as any)
      const data = await response.json()

      expect(data.duration).toBeDefined()
      expect(typeof data.duration).toBe('number')
    })
  })

  describe('Response Format', () => {
    it('should return correct success response format', async () => {
      const mockSections = [{ class_nbr: '12430', term: '2261' }]

      const { getSectionsToCheck } = vi.mocked(await import('@/lib/db/queries'))
      getSectionsToCheck.mockResolvedValue(mockSections)

      const request = createMockRequest('http://localhost:3000/api/cron', {
        method: 'GET',
        headers: { Authorization: 'Bearer test-cron-secret' },
      })

      const response = await GET(request as any)
      const data = await response.json()

      expect(data).toMatchObject({
        success: true,
        sections_enqueued: 1,
        stagger_group: expect.stringMatching(/^(even|odd)$/),
        duration: expect.any(Number),
      })
    })

    it('should track execution duration', async () => {
      const { getSectionsToCheck } = vi.mocked(await import('@/lib/db/queries'))
      getSectionsToCheck.mockResolvedValue([])

      const request = createMockRequest('http://localhost:3000/api/cron', {
        method: 'GET',
        headers: { Authorization: 'Bearer test-cron-secret' },
      })

      const response = await GET(request as any)
      const data = await response.json()

      expect(data.duration).toBeGreaterThanOrEqual(0)
      expect(typeof data.duration).toBe('number')
    })
  })
})
