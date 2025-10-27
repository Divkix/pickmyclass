import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  CircuitBreaker,
  CircuitState,
  CircuitBreakerError,
  getScraperCircuitBreaker,
} from '@/lib/utils/circuit-breaker'

describe('CircuitBreaker', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  describe('CLOSED state (normal operation)', () => {
    it('should start in CLOSED state', () => {
      const breaker = new CircuitBreaker({ name: 'test' })
      expect(breaker.getState()).toBe(CircuitState.CLOSED)
    })

    it('should execute function successfully in CLOSED state', async () => {
      const breaker = new CircuitBreaker({ name: 'test' })
      const fn = vi.fn().mockResolvedValue('success')

      const result = await breaker.execute(fn)

      expect(result).toBe('success')
      expect(fn).toHaveBeenCalledOnce()
      expect(breaker.getState()).toBe(CircuitState.CLOSED)
    })

    it('should reset failure count after successful execution', async () => {
      const breaker = new CircuitBreaker({ name: 'test', failureThreshold: 3 })
      const failFn = vi.fn().mockRejectedValue(new Error('fail'))
      const successFn = vi.fn().mockResolvedValue('success')

      // Fail twice
      await expect(breaker.execute(failFn)).rejects.toThrow('fail')
      await expect(breaker.execute(failFn)).rejects.toThrow('fail')
      expect(breaker.getFailureCount()).toBe(2)

      // One success should reset count
      await breaker.execute(successFn)
      expect(breaker.getFailureCount()).toBe(0)
      expect(breaker.getState()).toBe(CircuitState.CLOSED)
    })

    it('should count failures incrementally', async () => {
      const breaker = new CircuitBreaker({ name: 'test', failureThreshold: 5 })
      const fn = vi.fn().mockRejectedValue(new Error('fail'))

      for (let i = 1; i <= 4; i++) {
        await expect(breaker.execute(fn)).rejects.toThrow('fail')
        expect(breaker.getFailureCount()).toBe(i)
        expect(breaker.getState()).toBe(CircuitState.CLOSED)
      }
    })
  })

  describe('CLOSED → OPEN transition', () => {
    it('should transition to OPEN after reaching failure threshold', async () => {
      const breaker = new CircuitBreaker({ name: 'test', failureThreshold: 3 })
      const fn = vi.fn().mockRejectedValue(new Error('fail'))

      // Fail 3 times (reach threshold)
      await expect(breaker.execute(fn)).rejects.toThrow('fail')
      await expect(breaker.execute(fn)).rejects.toThrow('fail')
      await expect(breaker.execute(fn)).rejects.toThrow('fail')

      expect(breaker.getState()).toBe(CircuitState.OPEN)
      expect(breaker.getFailureCount()).toBe(3)
    })

    it('should block requests immediately when OPEN', async () => {
      const breaker = new CircuitBreaker({ name: 'test', failureThreshold: 2 })
      const fn = vi.fn().mockRejectedValue(new Error('fail'))

      // Reach threshold
      await expect(breaker.execute(fn)).rejects.toThrow('fail')
      await expect(breaker.execute(fn)).rejects.toThrow('fail')
      expect(breaker.getState()).toBe(CircuitState.OPEN)

      // Next call should be blocked without calling function
      await expect(breaker.execute(fn)).rejects.toThrow(CircuitBreakerError)
      await expect(breaker.execute(fn)).rejects.toThrow(
        'Circuit breaker is OPEN for test (service unavailable)'
      )
      expect(fn).toHaveBeenCalledTimes(2) // Function not called on blocked requests
    })

    it('should record failure time when opening', async () => {
      const breaker = new CircuitBreaker({ name: 'test', failureThreshold: 1 })
      const fn = vi.fn().mockRejectedValue(new Error('fail'))

      const before = Date.now()
      await expect(breaker.execute(fn)).rejects.toThrow('fail')
      const after = Date.now()

      const status = breaker.getStatus()
      expect(status.lastFailureTime).toBeGreaterThanOrEqual(before)
      expect(status.lastFailureTime).toBeLessThanOrEqual(after)
    })
  })

  describe('OPEN → HALF_OPEN transition', () => {
    it('should transition to HALF_OPEN after reset timeout', async () => {
      const breaker = new CircuitBreaker({
        name: 'test',
        failureThreshold: 1,
        resetTimeout: 60000, // 1 minute
      })
      const failFn = vi.fn().mockRejectedValue(new Error('fail'))
      const successFn = vi.fn().mockResolvedValue('success')

      // Open circuit
      await expect(breaker.execute(failFn)).rejects.toThrow('fail')
      expect(breaker.getState()).toBe(CircuitState.OPEN)

      // Advance time to reset timeout
      vi.advanceTimersByTime(60000)

      // Next call should transition to HALF_OPEN and execute
      await breaker.execute(successFn)
      expect(breaker.getState()).toBe(CircuitState.HALF_OPEN)
      expect(successFn).toHaveBeenCalledOnce()
    })

    it('should remain OPEN if reset timeout not reached', async () => {
      const breaker = new CircuitBreaker({
        name: 'test',
        failureThreshold: 1,
        resetTimeout: 60000,
      })
      const fn = vi.fn().mockRejectedValue(new Error('fail'))

      // Open circuit
      await expect(breaker.execute(fn)).rejects.toThrow('fail')
      expect(breaker.getState()).toBe(CircuitState.OPEN)

      // Advance time but not enough
      vi.advanceTimersByTime(30000) // 30 seconds (half of reset timeout)

      // Should still be blocked
      await expect(breaker.execute(fn)).rejects.toThrow(CircuitBreakerError)
      expect(breaker.getState()).toBe(CircuitState.OPEN)
    })
  })

  describe('HALF_OPEN state', () => {
    it('should allow test requests in HALF_OPEN', async () => {
      const breaker = new CircuitBreaker({
        name: 'test',
        failureThreshold: 1,
        resetTimeout: 60000,
      })
      const failFn = vi.fn().mockRejectedValue(new Error('fail'))
      const successFn = vi.fn().mockResolvedValue('success')

      // Open circuit
      await expect(breaker.execute(failFn)).rejects.toThrow('fail')

      // Advance to reset timeout
      vi.advanceTimersByTime(60000)

      // Execute should work in HALF_OPEN
      await breaker.execute(successFn)
      expect(successFn).toHaveBeenCalled()
    })

    it('should count successes in HALF_OPEN state', async () => {
      const breaker = new CircuitBreaker({
        name: 'test',
        failureThreshold: 1,
        resetTimeout: 60000,
        successThreshold: 3,
      })
      const failFn = vi.fn().mockRejectedValue(new Error('fail'))
      const successFn = vi.fn().mockResolvedValue('success')

      // Open circuit
      await expect(breaker.execute(failFn)).rejects.toThrow('fail')
      vi.advanceTimersByTime(60000)

      // First success
      await breaker.execute(successFn)
      const status1 = breaker.getStatus()
      expect(status1.state).toBe(CircuitState.HALF_OPEN)
      expect(status1.successCount).toBe(1)

      // Second success
      await breaker.execute(successFn)
      const status2 = breaker.getStatus()
      expect(status2.state).toBe(CircuitState.HALF_OPEN)
      expect(status2.successCount).toBe(2)
    })

    it('should transition HALF_OPEN → CLOSED after success threshold', async () => {
      const breaker = new CircuitBreaker({
        name: 'test',
        failureThreshold: 1,
        resetTimeout: 60000,
        successThreshold: 2,
      })
      const failFn = vi.fn().mockRejectedValue(new Error('fail'))
      const successFn = vi.fn().mockResolvedValue('success')

      // Open circuit
      await expect(breaker.execute(failFn)).rejects.toThrow('fail')
      vi.advanceTimersByTime(60000)

      // 2 successes should close circuit
      await breaker.execute(successFn)
      expect(breaker.getState()).toBe(CircuitState.HALF_OPEN)

      await breaker.execute(successFn)
      expect(breaker.getState()).toBe(CircuitState.CLOSED)
    })

    it('should transition HALF_OPEN → OPEN on any failure', async () => {
      const breaker = new CircuitBreaker({
        name: 'test',
        failureThreshold: 1,
        resetTimeout: 60000,
        successThreshold: 3,
      })
      const failFn = vi.fn().mockRejectedValue(new Error('fail'))
      const successFn = vi.fn().mockResolvedValue('success')

      // Open circuit
      await expect(breaker.execute(failFn)).rejects.toThrow('fail')
      vi.advanceTimersByTime(60000)

      // One success
      await breaker.execute(successFn)
      expect(breaker.getState()).toBe(CircuitState.HALF_OPEN)

      // One failure should reopen
      await expect(breaker.execute(failFn)).rejects.toThrow('fail')
      expect(breaker.getState()).toBe(CircuitState.OPEN)
    })

    it('should reset success count when transitioning back to OPEN', async () => {
      const breaker = new CircuitBreaker({
        name: 'test',
        failureThreshold: 1,
        resetTimeout: 60000,
        successThreshold: 3,
      })
      const failFn = vi.fn().mockRejectedValue(new Error('fail'))
      const successFn = vi.fn().mockResolvedValue('success')

      // Open circuit
      await expect(breaker.execute(failFn)).rejects.toThrow('fail')
      vi.advanceTimersByTime(60000)

      // Two successes
      await breaker.execute(successFn)
      await breaker.execute(successFn)
      expect(breaker.getStatus().successCount).toBe(2)

      // Fail → should reset success count
      await expect(breaker.execute(failFn)).rejects.toThrow('fail')
      expect(breaker.getStatus().successCount).toBe(0)
    })
  })

  describe('timeout handling', () => {
    it('should timeout slow requests', async () => {
      const breaker = new CircuitBreaker({
        name: 'test',
        timeout: 1000, // 1 second timeout
      })
      const slowFn = vi.fn(
        () =>
          new Promise(resolve => {
            setTimeout(() => resolve('too slow'), 5000)
          })
      )

      await expect(breaker.execute(slowFn)).rejects.toThrow('Request timeout after 1000ms')
      expect(breaker.getFailureCount()).toBe(1)
    })

    it('should count timeout as failure', async () => {
      const breaker = new CircuitBreaker({
        name: 'test',
        timeout: 100,
        failureThreshold: 2,
      })
      const slowFn = vi.fn(() => new Promise(resolve => setTimeout(() => resolve('slow'), 1000)))

      await expect(breaker.execute(slowFn)).rejects.toThrow('Request timeout')
      await expect(breaker.execute(slowFn)).rejects.toThrow('Request timeout')

      expect(breaker.getState()).toBe(CircuitState.OPEN)
    })
  })

  describe('reset() method', () => {
    it('should manually reset circuit to CLOSED', async () => {
      const breaker = new CircuitBreaker({ name: 'test', failureThreshold: 1 })
      const fn = vi.fn().mockRejectedValue(new Error('fail'))

      // Open circuit
      await expect(breaker.execute(fn)).rejects.toThrow('fail')
      expect(breaker.getState()).toBe(CircuitState.OPEN)

      // Manual reset
      breaker.reset()
      expect(breaker.getState()).toBe(CircuitState.CLOSED)
      expect(breaker.getFailureCount()).toBe(0)
    })

    it('should clear failure count and last failure time', async () => {
      const breaker = new CircuitBreaker({ name: 'test', failureThreshold: 2 })
      const fn = vi.fn().mockRejectedValue(new Error('fail'))

      await expect(breaker.execute(fn)).rejects.toThrow('fail')
      await expect(breaker.execute(fn)).rejects.toThrow('fail')

      breaker.reset()

      const status = breaker.getStatus()
      expect(status.failureCount).toBe(0)
      expect(status.lastFailureTime).toBeNull()
    })
  })

  describe('getStatus()', () => {
    it('should return complete status object', async () => {
      const breaker = new CircuitBreaker({
        name: 'test-service',
        failureThreshold: 3,
      })
      const fn = vi.fn().mockRejectedValue(new Error('fail'))

      await expect(breaker.execute(fn)).rejects.toThrow('fail')

      const status = breaker.getStatus()
      expect(status).toMatchObject({
        name: 'test-service',
        state: CircuitState.CLOSED,
        failureCount: 1,
        successCount: 0,
      })
      expect(status.lastFailureTime).toBeTypeOf('number')
    })
  })

  describe('getScraperCircuitBreaker() singleton', () => {
    it('should return same instance on multiple calls', () => {
      const breaker1 = getScraperCircuitBreaker()
      const breaker2 = getScraperCircuitBreaker()

      expect(breaker1).toBe(breaker2)
    })

    it('should have correct scraper configuration', () => {
      const breaker = getScraperCircuitBreaker()
      const status = breaker.getStatus()

      expect(status.name).toBe('ASU-Scraper')
      expect(breaker.getState()).toBe(CircuitState.CLOSED)
    })
  })

  describe('error types', () => {
    it('should throw CircuitBreakerError when circuit is open', async () => {
      const breaker = new CircuitBreaker({ name: 'test', failureThreshold: 1 })
      const fn = vi.fn().mockRejectedValue(new Error('fail'))

      // Open circuit
      await expect(breaker.execute(fn)).rejects.toThrow('fail')

      // Should throw CircuitBreakerError
      await expect(breaker.execute(fn)).rejects.toThrow(CircuitBreakerError)

      try {
        await breaker.execute(fn)
      } catch (error) {
        expect(error).toBeInstanceOf(CircuitBreakerError)
        expect((error as CircuitBreakerError).circuitBreakerOpen).toBe(true)
      }
    })

    it('should propagate original error when circuit is closed', async () => {
      const breaker = new CircuitBreaker({ name: 'test' })
      const customError = new Error('custom error')
      const fn = vi.fn().mockRejectedValue(customError)

      await expect(breaker.execute(fn)).rejects.toThrow(customError)
    })
  })

  describe('concurrent requests', () => {
    it('should handle concurrent requests correctly', async () => {
      const breaker = new CircuitBreaker({
        name: 'test',
        failureThreshold: 5,
        timeout: 100,
      })
      const successFn = vi.fn().mockResolvedValue('success')

      // Execute 10 concurrent requests
      const promises = Array(10)
        .fill(null)
        .map(() => breaker.execute(successFn))

      const results = await Promise.all(promises)

      expect(results).toEqual(Array(10).fill('success'))
      expect(successFn).toHaveBeenCalledTimes(10)
      expect(breaker.getState()).toBe(CircuitState.CLOSED)
    })
  })

  describe('configuration defaults', () => {
    it('should use default values when not provided', () => {
      const breaker = new CircuitBreaker({ name: 'test' })
      const status = breaker.getStatus()

      expect(status.name).toBe('test')
      // Defaults are set in constructor, verify they work
      expect(breaker.getState()).toBe(CircuitState.CLOSED)
    })

    it('should allow custom configuration', () => {
      const breaker = new CircuitBreaker({
        name: 'custom',
        failureThreshold: 10,
        resetTimeout: 120000,
        successThreshold: 5,
        timeout: 60000,
      })

      const status = breaker.getStatus()
      expect(status.name).toBe('custom')
    })
  })
})
