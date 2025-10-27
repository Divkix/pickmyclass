import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { checkRateLimit } from '@/lib/rate-limit'

describe('Rate Limiting', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('checkRateLimit', () => {
    it('should allow requests within limit', () => {
      const config = { windowMs: 60000, maxRequests: 5 }

      const result1 = checkRateLimit('192.168.1.1', config)
      expect(result1.allowed).toBe(true)
      expect(result1.remaining).toBe(4)

      const result2 = checkRateLimit('192.168.1.1', config)
      expect(result2.allowed).toBe(true)
      expect(result2.remaining).toBe(3)
    })

    it('should block requests exceeding limit', () => {
      const config = { windowMs: 60000, maxRequests: 3 }

      // Make 3 allowed requests
      checkRateLimit('192.168.1.1', config)
      checkRateLimit('192.168.1.1', config)
      checkRateLimit('192.168.1.1', config)

      // 4th request should be blocked
      const result = checkRateLimit('192.168.1.1', config)
      expect(result.allowed).toBe(false)
      expect(result.remaining).toBe(0)
    })

    it('should track requests per identifier separately', () => {
      const config = { windowMs: 60000, maxRequests: 2 }

      checkRateLimit('192.168.1.1', config)
      checkRateLimit('192.168.1.1', config)

      // Different IP should have separate limit
      const result = checkRateLimit('192.168.1.2', config)
      expect(result.allowed).toBe(true)
      expect(result.remaining).toBe(1)
    })

    it('should implement sliding window algorithm', () => {
      const config = { windowMs: 60000, maxRequests: 2 }

      // Make 2 requests at t=0
      checkRateLimit('192.168.1.1', config)
      checkRateLimit('192.168.1.1', config)

      // 3rd request blocked at t=0
      let result = checkRateLimit('192.168.1.1', config)
      expect(result.allowed).toBe(false)

      // Advance time by 61 seconds (past window)
      vi.advanceTimersByTime(61000)

      // Request should now be allowed
      result = checkRateLimit('192.168.1.1', config)
      expect(result.allowed).toBe(true)
      expect(result.remaining).toBe(1)
    })

    it('should calculate correct remaining requests', () => {
      const config = { windowMs: 60000, maxRequests: 10 }

      for (let i = 0; i < 5; i++) {
        const result = checkRateLimit('192.168.1.1', config)
        expect(result.remaining).toBe(10 - i - 1)
      }
    })

    it('should calculate correct reset time', () => {
      const config = { windowMs: 60000, maxRequests: 5 }
      const startTime = Date.now()

      const result = checkRateLimit('192.168.1.1', config)

      expect(result.resetAt).toBe(startTime + config.windowMs)
    })

    it('should handle zero remaining correctly when blocked', () => {
      const config = { windowMs: 60000, maxRequests: 1 }

      // First request allowed
      const result1 = checkRateLimit('192.168.1.1', config)
      expect(result1.allowed).toBe(true)
      expect(result1.remaining).toBe(0)

      // Second request blocked
      const result2 = checkRateLimit('192.168.1.1', config)
      expect(result2.allowed).toBe(false)
      expect(result2.remaining).toBe(0)
    })

    it('should clean up old timestamps from window', () => {
      const config = { windowMs: 10000, maxRequests: 3 }

      // Make 2 requests at t=0
      checkRateLimit('192.168.1.1', config)
      checkRateLimit('192.168.1.1', config)

      // Advance past window
      vi.advanceTimersByTime(11000)

      // Old timestamps should be removed, so we have full limit again
      const result = checkRateLimit('192.168.1.1', config)
      expect(result.allowed).toBe(true)
      expect(result.remaining).toBe(2)
    })

    it('should handle edge case of request exactly at window boundary', () => {
      const config = { windowMs: 60000, maxRequests: 2 }

      checkRateLimit('192.168.1.1', config)
      checkRateLimit('192.168.1.1', config)

      // Advance exactly to window end
      vi.advanceTimersByTime(60000)

      // Timestamps at exactly windowStart should be filtered out
      const result = checkRateLimit('192.168.1.1', config)
      expect(result.allowed).toBe(true)
    })

    it('should not add timestamp when request is blocked', () => {
      const config = { windowMs: 60000, maxRequests: 2 }

      checkRateLimit('192.168.1.1', config)
      checkRateLimit('192.168.1.1', config)

      // This should be blocked and not increment counter
      checkRateLimit('192.168.1.1', config)
      checkRateLimit('192.168.1.1', config)

      // Advance past window
      vi.advanceTimersByTime(61000)

      // Should have full limit again (blocked requests weren't counted)
      const result = checkRateLimit('192.168.1.1', config)
      expect(result.allowed).toBe(true)
      expect(result.remaining).toBe(1)
    })
  })

  describe('Different rate limit configurations', () => {
    it('should work with short windows', () => {
      const config = { windowMs: 1000, maxRequests: 2 } // 1 second

      checkRateLimit('test', config)
      checkRateLimit('test', config)

      let result = checkRateLimit('test', config)
      expect(result.allowed).toBe(false)

      vi.advanceTimersByTime(1100)

      result = checkRateLimit('test', config)
      expect(result.allowed).toBe(true)
    })

    it('should work with high request limits', () => {
      const config = { windowMs: 60000, maxRequests: 1000 }

      for (let i = 0; i < 500; i++) {
        const result = checkRateLimit('test', config)
        expect(result.allowed).toBe(true)
      }

      const result = checkRateLimit('test', config)
      expect(result.remaining).toBe(499)
    })

    it('should work with very restrictive limits', () => {
      const config = { windowMs: 60000, maxRequests: 1 }

      const result1 = checkRateLimit('test', config)
      expect(result1.allowed).toBe(true)

      const result2 = checkRateLimit('test', config)
      expect(result2.allowed).toBe(false)
      expect(result2.remaining).toBe(0)
    })
  })
})
