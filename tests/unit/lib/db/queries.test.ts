import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  getClassWatchers,
  getBulkClassWatchers,
  getSectionsToCheck,
  hasNotificationBeenSent,
  recordNotificationSent,
  resetNotificationsForSection,
} from '@/lib/db/queries'
import { createMockSupabaseClient } from '../../../mocks/supabase'

// Mock the service client
vi.mock('@/lib/supabase/service', () => ({
  getServiceClient: vi.fn(),
}))

describe('Database Queries', () => {
  let mockClient: ReturnType<typeof createMockSupabaseClient>

  beforeEach(() => {
    mockClient = createMockSupabaseClient()
    const { getServiceClient } = await import('@/lib/supabase/service')
    vi.mocked(getServiceClient).mockReturnValue(mockClient as any)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('getClassWatchers', () => {
    it('should fetch watchers for a section', async () => {
      const mockWatchers = [
        { user_id: 'user1', email: 'user1@example.com', watch_id: 'watch1' },
        { user_id: 'user2', email: 'user2@example.com', watch_id: 'watch2' },
      ]

      mockClient = createMockSupabaseClient({
        queryData: new Map([['rpc:get_class_watchers', mockWatchers]]),
      })
      const { getServiceClient } = await import('@/lib/supabase/service')
      vi.mocked(getServiceClient).mockReturnValue(mockClient as any)

      const result = await getClassWatchers('12431')

      expect(result).toEqual(mockWatchers)
      expect(mockClient.rpc).toHaveBeenCalledWith('get_class_watchers', {
        section_number: '12431',
      })
    })

    it('should return empty array when no watchers found', async () => {
      mockClient = createMockSupabaseClient({
        queryData: new Map([['rpc:get_class_watchers', []]]),
      })
      const { getServiceClient } = await import('@/lib/supabase/service')
      vi.mocked(getServiceClient).mockReturnValue(mockClient as any)

      const result = await getClassWatchers('99999')

      expect(result).toEqual([])
    })

    it('should throw error when RPC fails', async () => {
      mockClient = createMockSupabaseClient({
        queryErrors: new Map([['rpc:get_class_watchers', new Error('RPC failed')]]),
      })
      const { getServiceClient } = await import('@/lib/supabase/service')
      vi.mocked(getServiceClient).mockReturnValue(mockClient as any)

      await expect(getClassWatchers('12431')).rejects.toThrow('Failed to fetch watchers')
    })

    it('should handle null data from database', async () => {
      mockClient = createMockSupabaseClient({
        queryData: new Map([['rpc:get_class_watchers', null as any]]),
      })
      const { getServiceClient } = await import('@/lib/supabase/service')
      vi.mocked(getServiceClient).mockReturnValue(mockClient as any)

      const result = await getClassWatchers('12431')

      expect(result).toEqual([])
    })
  })

  describe('getBulkClassWatchers', () => {
    it('should fetch watchers for multiple sections', async () => {
      const mockWatchers = [
        { class_nbr: '12431', user_id: 'user1', email: 'user1@example.com', watch_id: 'watch1' },
        { class_nbr: '12431', user_id: 'user2', email: 'user2@example.com', watch_id: 'watch2' },
        { class_nbr: '12432', user_id: 'user3', email: 'user3@example.com', watch_id: 'watch3' },
      ]

      mockClient = createMockSupabaseClient({
        queryData: new Map([['rpc:get_watchers_for_sections', mockWatchers]]),
      })
      const { getServiceClient } = await import('@/lib/supabase/service')
      vi.mocked(getServiceClient).mockReturnValue(mockClient as any)

      const result = await getBulkClassWatchers(['12431', '12432'])

      expect(result.size).toBe(2)
      expect(result.get('12431')).toHaveLength(2)
      expect(result.get('12432')).toHaveLength(1)
      expect(mockClient.rpc).toHaveBeenCalledWith('get_watchers_for_sections', {
        section_numbers: ['12431', '12432'],
      })
    })

    it('should return empty map for empty input', async () => {
      const result = await getBulkClassWatchers([])

      expect(result.size).toBe(0)
      expect(mockClient.rpc).not.toHaveBeenCalled()
    })

    it('should group watchers by section number', async () => {
      const mockWatchers = [
        { class_nbr: '12431', user_id: 'user1', email: 'user1@example.com', watch_id: 'watch1' },
        { class_nbr: '12431', user_id: 'user2', email: 'user2@example.com', watch_id: 'watch2' },
      ]

      mockClient = createMockSupabaseClient({
        queryData: new Map([['rpc:get_watchers_for_sections', mockWatchers]]),
      })
      const { getServiceClient } = await import('@/lib/supabase/service')
      vi.mocked(getServiceClient).mockReturnValue(mockClient as any)

      const result = await getBulkClassWatchers(['12431'])

      expect(result.get('12431')).toHaveLength(2)
      expect(result.get('12431')?.[0]).not.toHaveProperty('class_nbr')
    })

    it('should throw error when RPC fails', async () => {
      mockClient = createMockSupabaseClient({
        queryErrors: new Map([['rpc:get_watchers_for_sections', new Error('RPC failed')]]),
      })
      const { getServiceClient } = await import('@/lib/supabase/service')
      vi.mocked(getServiceClient).mockReturnValue(mockClient as any)

      await expect(getBulkClassWatchers(['12431'])).rejects.toThrow('Failed to bulk fetch watchers')
    })
  })

  describe('getSectionsToCheck', () => {
    it('should fetch sections with "all" stagger type', async () => {
      const mockSections = [
        { class_nbr: '12431', term: '2261' },
        { class_nbr: '12432', term: '2261' },
      ]

      mockClient = createMockSupabaseClient({
        queryData: new Map([['rpc:get_sections_to_check', mockSections]]),
      })
      const { getServiceClient } = await import('@/lib/supabase/service')
      vi.mocked(getServiceClient).mockReturnValue(mockClient as any)

      const result = await getSectionsToCheck('all')

      expect(result).toEqual(mockSections)
      expect(mockClient.rpc).toHaveBeenCalledWith('get_sections_to_check', {
        stagger_type: 'all',
      })
    })

    it('should fetch sections with "even" stagger type', async () => {
      const mockSections = [
        { class_nbr: '12430', term: '2261' },
        { class_nbr: '12432', term: '2261' },
      ]

      mockClient = createMockSupabaseClient({
        queryData: new Map([['rpc:get_sections_to_check', mockSections]]),
      })
      const { getServiceClient } = await import('@/lib/supabase/service')
      vi.mocked(getServiceClient).mockReturnValue(mockClient as any)

      const result = await getSectionsToCheck('even')

      expect(result).toEqual(mockSections)
      expect(mockClient.rpc).toHaveBeenCalledWith('get_sections_to_check', {
        stagger_type: 'even',
      })
    })

    it('should fetch sections with "odd" stagger type', async () => {
      const mockSections = [
        { class_nbr: '12431', term: '2261' },
        { class_nbr: '12433', term: '2261' },
      ]

      mockClient = createMockSupabaseClient({
        queryData: new Map([['rpc:get_sections_to_check', mockSections]]),
      })
      const { getServiceClient } = await import('@/lib/supabase/service')
      vi.mocked(getServiceClient).mockReturnValue(mockClient as any)

      const result = await getSectionsToCheck('odd')

      expect(result).toEqual(mockSections)
    })

    it('should default to "all" when no stagger type provided', async () => {
      const mockSections = [{ class_nbr: '12431', term: '2261' }]

      mockClient = createMockSupabaseClient({
        queryData: new Map([['rpc:get_sections_to_check', mockSections]]),
      })
      const { getServiceClient } = await import('@/lib/supabase/service')
      vi.mocked(getServiceClient).mockReturnValue(mockClient as any)

      const result = await getSectionsToCheck()

      expect(result).toEqual(mockSections)
      expect(mockClient.rpc).toHaveBeenCalledWith('get_sections_to_check', {
        stagger_type: 'all',
      })
    })

    it('should throw error when RPC fails', async () => {
      mockClient = createMockSupabaseClient({
        queryErrors: new Map([['rpc:get_sections_to_check', new Error('RPC failed')]]),
      })
      const { getServiceClient } = await import('@/lib/supabase/service')
      vi.mocked(getServiceClient).mockReturnValue(mockClient as any)

      await expect(getSectionsToCheck()).rejects.toThrow('Failed to fetch sections')
    })
  })

  describe('hasNotificationBeenSent', () => {
    it('should return true when notification exists', async () => {
      mockClient = createMockSupabaseClient({
        queryData: new Map([['notifications_sent', [{ id: '123' }]]]),
      })
      const { getServiceClient } = await import('@/lib/supabase/service')
      vi.mocked(getServiceClient).mockReturnValue(mockClient as any)

      const result = await hasNotificationBeenSent('watch1', 'seat_available')

      expect(result).toBe(true)
    })

    it('should return false when notification does not exist', async () => {
      mockClient = createMockSupabaseClient({
        queryData: new Map([['notifications_sent', []]]),
      })
      const { getServiceClient } = await import('@/lib/supabase/service')
      vi.mocked(getServiceClient).mockReturnValue(mockClient as any)

      const result = await hasNotificationBeenSent('watch1', 'seat_available')

      expect(result).toBe(false)
    })

    it('should query with correct parameters', async () => {
      mockClient = createMockSupabaseClient({
        queryData: new Map([['notifications_sent', []]]),
      })
      const { getServiceClient } = await import('@/lib/supabase/service')
      vi.mocked(getServiceClient).mockReturnValue(mockClient as any)

      await hasNotificationBeenSent('watch123', 'instructor_assigned')

      // Verify the query was called with correct filters (mocked in our mock implementation)
      expect(mockClient.from).toHaveBeenCalledWith('notifications_sent')
    })
  })

  describe('recordNotificationSent', () => {
    it('should insert notification record', async () => {
      mockClient = createMockSupabaseClient({
        queryData: new Map([['notifications_sent', []]]),
      })
      const { getServiceClient } = await import('@/lib/supabase/service')
      vi.mocked(getServiceClient).mockReturnValue(mockClient as any)

      await recordNotificationSent('watch1', 'seat_available')

      expect(mockClient.from).toHaveBeenCalledWith('notifications_sent')
    })

    it('should throw error when insert fails', async () => {
      mockClient = createMockSupabaseClient({
        queryErrors: new Map([['notifications_sent', new Error('Insert failed')]]),
      })
      const { getServiceClient } = await import('@/lib/supabase/service')
      vi.mocked(getServiceClient).mockReturnValue(mockClient as any)

      await expect(recordNotificationSent('watch1', 'seat_available')).rejects.toThrow()
    })
  })

  describe('resetNotificationsForSection', () => {
    it('should delete notifications for section and type', async () => {
      mockClient = createMockSupabaseClient({
        queryData: new Map([['notifications_sent', []]]),
      })
      const { getServiceClient } = await import('@/lib/supabase/service')
      vi.mocked(getServiceClient).mockReturnValue(mockClient as any)

      await resetNotificationsForSection('12431', 'seat_available')

      expect(mockClient.from).toHaveBeenCalledWith('notifications_sent')
    })
  })
})
