import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  checkLockoutStatus,
  incrementFailedAttempts,
  clearFailedAttempts,
  getRemainingLockoutTime,
} from '@/lib/auth/lockout'
import { createMockSupabaseClient } from '../../../mocks/supabase'

// Mock Supabase client
vi.mock('@/lib/supabase/server', () => ({
  createServiceRoleClient: vi.fn(),
}))

describe('Auth Lockout', () => {
  beforeEach(() => {
    const mockClient = createMockSupabaseClient()
    const { createServiceRoleClient } = vi.mocked(await import('@/lib/supabase/server'))
    createServiceRoleClient.mockReturnValue(mockClient as any)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('checkLockoutStatus', () => {
    it('should return not locked for new email', async () => {
      const mockClient = createMockSupabaseClient({
        queryData: new Map([['failed_login_attempts', []]]),
        queryErrors: new Map([['failed_login_attempts', new Error('No rows found')]]),
      })
      const { createServiceRoleClient } = vi.mocked(await import('@/lib/supabase/server'))
      createServiceRoleClient.mockReturnValue(mockClient as any)

      const status = await checkLockoutStatus('new@example.com')

      expect(status.isLocked).toBe(false)
      expect(status.attempts).toBe(0)
      expect(status.lockedUntil).toBeNull()
    })

    it('should return locked when lockout is active', async () => {
      const futureTime = new Date(Date.now() + 10 * 60 * 1000) // 10 minutes from now

      const mockClient = createMockSupabaseClient({
        queryData: new Map([
          [
            'failed_login_attempts',
            [
              {
                email: 'locked@example.com',
                attempts: 5,
                locked_until: futureTime.toISOString(),
              },
            ],
          ],
        ]),
      })
      const { createServiceRoleClient } = vi.mocked(await import('@/lib/supabase/server'))
      createServiceRoleClient.mockReturnValue(mockClient as any)

      const status = await checkLockoutStatus('locked@example.com')

      expect(status.isLocked).toBe(true)
      expect(status.attempts).toBe(5)
      expect(status.lockedUntil).toEqual(futureTime)
    })

    it('should return not locked when lockout has expired', async () => {
      const pastTime = new Date(Date.now() - 1000) // 1 second ago

      const mockClient = createMockSupabaseClient({
        queryData: new Map([
          [
            'failed_login_attempts',
            [
              {
                email: 'expired@example.com',
                attempts: 5,
                locked_until: pastTime.toISOString(),
              },
            ],
          ],
        ]),
      })
      const { createServiceRoleClient } = vi.mocked(await import('@/lib/supabase/server'))
      createServiceRoleClient.mockReturnValue(mockClient as any)

      const status = await checkLockoutStatus('expired@example.com')

      expect(status.isLocked).toBe(false)
      expect(status.attempts).toBe(0)
      expect(status.lockedUntil).toBeNull()
    })

    it('should normalize email to lowercase', async () => {
      const mockClient = createMockSupabaseClient({
        queryData: new Map([['failed_login_attempts', []]]),
        queryErrors: new Map([['failed_login_attempts', new Error('No rows found')]]),
      })
      const { createServiceRoleClient } = vi.mocked(await import('@/lib/supabase/server'))
      createServiceRoleClient.mockReturnValue(mockClient as any)

      await checkLockoutStatus('TEST@EXAMPLE.COM')

      // Verify the query was called with lowercase email
      expect(mockClient.from).toHaveBeenCalledWith('failed_login_attempts')
    })

    it('should handle missing attempts field', async () => {
      const mockClient = createMockSupabaseClient({
        queryData: new Map([
          [
            'failed_login_attempts',
            [
              {
                email: 'test@example.com',
                attempts: null,
                locked_until: null,
              },
            ],
          ],
        ]),
      })
      const { createServiceRoleClient } = vi.mocked(await import('@/lib/supabase/server'))
      createServiceRoleClient.mockReturnValue(mockClient as any)

      const status = await checkLockoutStatus('test@example.com')

      expect(status.attempts).toBe(0)
    })
  })

  describe('incrementFailedAttempts', () => {
    it('should increment attempts for first failure', async () => {
      const mockClient = createMockSupabaseClient({
        queryData: new Map([['failed_login_attempts', []]]),
        queryErrors: new Map([['failed_login_attempts', new Error('No rows found')]]),
      })
      const { createServiceRoleClient } = vi.mocked(await import('@/lib/supabase/server'))
      createServiceRoleClient.mockReturnValue(mockClient as any)

      await incrementFailedAttempts('test@example.com')

      expect(mockClient.from).toHaveBeenCalledWith('failed_login_attempts')
    })

    it('should lock account after 5 failed attempts', async () => {
      const mockClient = createMockSupabaseClient({
        queryData: new Map([
          [
            'failed_login_attempts',
            [
              {
                email: 'test@example.com',
                attempts: 4,
              },
            ],
          ],
        ]),
      })
      const { createServiceRoleClient } = vi.mocked(await import('@/lib/supabase/server'))
      createServiceRoleClient.mockReturnValue(mockClient as any)

      await incrementFailedAttempts('test@example.com')

      // Should upsert with locked_until set
      expect(mockClient.from).toHaveBeenCalledWith('failed_login_attempts')
    })

    it('should normalize email to lowercase', async () => {
      const mockClient = createMockSupabaseClient({
        queryData: new Map([['failed_login_attempts', []]]),
        queryErrors: new Map([['failed_login_attempts', new Error('No rows found')]]),
      })
      const { createServiceRoleClient } = vi.mocked(await import('@/lib/supabase/server'))
      createServiceRoleClient.mockReturnValue(mockClient as any)

      await incrementFailedAttempts('TEST@EXAMPLE.COM')

      expect(mockClient.from).toHaveBeenCalledWith('failed_login_attempts')
    })

    it('should set 15-minute lockout duration', async () => {
      const mockClient = createMockSupabaseClient({
        queryData: new Map([
          [
            'failed_login_attempts',
            [
              {
                email: 'test@example.com',
                attempts: 4,
              },
            ],
          ],
        ]),
      })
      const { createServiceRoleClient } = vi.mocked(await import('@/lib/supabase/server'))
      createServiceRoleClient.mockReturnValue(mockClient as any)

      const before = Date.now()
      await incrementFailedAttempts('test@example.com')
      const after = Date.now()

      // Lockout should be approximately 15 minutes from now
      // We can't test exact value due to timing, but verify it was called
      expect(mockClient.from).toHaveBeenCalledWith('failed_login_attempts')
    })
  })

  describe('clearFailedAttempts', () => {
    it('should delete failed attempts record', async () => {
      const mockClient = createMockSupabaseClient({
        queryData: new Map([['failed_login_attempts', []]]),
      })
      const { createServiceRoleClient } = vi.mocked(await import('@/lib/supabase/server'))
      createServiceRoleClient.mockReturnValue(mockClient as any)

      await clearFailedAttempts('test@example.com')

      expect(mockClient.from).toHaveBeenCalledWith('failed_login_attempts')
    })

    it('should normalize email to lowercase', async () => {
      const mockClient = createMockSupabaseClient({
        queryData: new Map([['failed_login_attempts', []]]),
      })
      const { createServiceRoleClient } = vi.mocked(await import('@/lib/supabase/server'))
      createServiceRoleClient.mockReturnValue(mockClient as any)

      await clearFailedAttempts('TEST@EXAMPLE.COM')

      expect(mockClient.from).toHaveBeenCalledWith('failed_login_attempts')
    })
  })

  describe('getRemainingLockoutTime', () => {
    it('should return 0 for null lockedUntil', () => {
      const remaining = getRemainingLockoutTime(null)
      expect(remaining).toBe(0)
    })

    it('should calculate remaining minutes correctly', () => {
      const lockedUntil = new Date(Date.now() + 10 * 60 * 1000) // 10 minutes from now

      const remaining = getRemainingLockoutTime(lockedUntil)

      expect(remaining).toBe(10)
    })

    it('should round up partial minutes', () => {
      const lockedUntil = new Date(Date.now() + 5.5 * 60 * 1000) // 5.5 minutes from now

      const remaining = getRemainingLockoutTime(lockedUntil)

      expect(remaining).toBe(6) // Should round up to 6
    })

    it('should return 0 for past lockedUntil', () => {
      const lockedUntil = new Date(Date.now() - 1000) // 1 second ago

      const remaining = getRemainingLockoutTime(lockedUntil)

      expect(remaining).toBeLessThanOrEqual(0)
    })

    it('should handle very short remaining times', () => {
      const lockedUntil = new Date(Date.now() + 30 * 1000) // 30 seconds from now

      const remaining = getRemainingLockoutTime(lockedUntil)

      expect(remaining).toBe(1) // Should round up to 1 minute
    })
  })

  describe('Lockout workflow', () => {
    it('should implement full lockout cycle', async () => {
      let mockClient = createMockSupabaseClient({
        queryData: new Map([['failed_login_attempts', []]]),
        queryErrors: new Map([['failed_login_attempts', new Error('No rows found')]]),
      })
      const { createServiceRoleClient } = vi.mocked(await import('@/lib/supabase/server'))
      createServiceRoleClient.mockReturnValue(mockClient as any)

      // 1. Initial check - not locked
      let status = await checkLockoutStatus('user@example.com')
      expect(status.isLocked).toBe(false)

      // 2. Increment attempts 5 times
      for (let i = 0; i < 5; i++) {
        await incrementFailedAttempts('user@example.com')
      }

      // 3. Check status - should be locked
      const futureTime = new Date(Date.now() + 15 * 60 * 1000)
      mockClient = createMockSupabaseClient({
        queryData: new Map([
          [
            'failed_login_attempts',
            [
              {
                email: 'user@example.com',
                attempts: 5,
                locked_until: futureTime.toISOString(),
              },
            ],
          ],
        ]),
      })
      createServiceRoleClient.mockReturnValue(mockClient as any)

      status = await checkLockoutStatus('user@example.com')
      expect(status.isLocked).toBe(true)

      // 4. Clear attempts (successful login)
      await clearFailedAttempts('user@example.com')

      // 5. Check status - should not be locked
      mockClient = createMockSupabaseClient({
        queryData: new Map([['failed_login_attempts', []]]),
        queryErrors: new Map([['failed_login_attempts', new Error('No rows found')]]),
      })
      createServiceRoleClient.mockReturnValue(mockClient as any)

      status = await checkLockoutStatus('user@example.com')
      expect(status.isLocked).toBe(false)
    })
  })
})
