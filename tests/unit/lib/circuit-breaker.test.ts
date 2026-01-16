import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock Redis client
const mockRedisClient = {
  get: vi.fn(),
  set: vi.fn(),
};

vi.mock('@/lib/redis/client', () => ({
  getRedisClient: vi.fn(() => mockRedisClient),
}));

// Import after mocking
const { CircuitBreaker, CircuitState, getCircuitBreaker } = await import(
  '@/lib/redis/circuit-breaker'
);

describe('CircuitBreaker', () => {
  let circuitBreaker: InstanceType<typeof CircuitBreaker>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-15T12:00:00Z'));
    circuitBreaker = new CircuitBreaker('test-breaker');
    mockRedisClient.get.mockReset();
    mockRedisClient.set.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('initial state', () => {
    it('should return CLOSED state when no state exists in Redis', async () => {
      mockRedisClient.get.mockResolvedValue(null);

      const result = await circuitBreaker.checkState();

      expect(result.allowed).toBe(true);
      expect(result.state).toBe(CircuitState.CLOSED);
    });

    it('should return CLOSED state when Redis returns invalid JSON', async () => {
      mockRedisClient.get.mockResolvedValue('invalid-json');

      const result = await circuitBreaker.checkState();

      expect(result.allowed).toBe(true);
      expect(result.state).toBe(CircuitState.CLOSED);
    });
  });

  describe('CLOSED -> OPEN transition', () => {
    it('should remain CLOSED when failures are below threshold', async () => {
      mockRedisClient.get.mockResolvedValue(
        JSON.stringify({
          state: CircuitState.CLOSED,
          failureCount: 5,
          successCount: 0,
          lastFailureTime: null,
          lastStateChange: Date.now(),
        })
      );
      mockRedisClient.set.mockResolvedValue('OK');

      const result = await circuitBreaker.recordFailure();

      expect(result.state).toBe(CircuitState.CLOSED);
    });

    it('should transition to OPEN after 10 consecutive failures', async () => {
      mockRedisClient.get.mockResolvedValue(
        JSON.stringify({
          state: CircuitState.CLOSED,
          failureCount: 9,
          successCount: 0,
          lastFailureTime: null,
          lastStateChange: Date.now(),
        })
      );
      mockRedisClient.set.mockResolvedValue('OK');

      const result = await circuitBreaker.recordFailure();

      expect(result.state).toBe(CircuitState.OPEN);
      expect(result.message).toContain('failure threshold exceeded');
    });

    it('should save OPEN state to Redis after threshold reached', async () => {
      mockRedisClient.get.mockResolvedValue(
        JSON.stringify({
          state: CircuitState.CLOSED,
          failureCount: 9,
          successCount: 0,
          lastFailureTime: null,
          lastStateChange: Date.now(),
        })
      );
      mockRedisClient.set.mockResolvedValue('OK');

      await circuitBreaker.recordFailure();

      expect(mockRedisClient.set).toHaveBeenCalledWith(
        'circuit-breaker:test-breaker',
        expect.stringContaining('"state":"OPEN"')
      );
    });
  });

  describe('OPEN state behavior', () => {
    it('should block requests when circuit is OPEN', async () => {
      const now = Date.now();
      mockRedisClient.get.mockResolvedValue(
        JSON.stringify({
          state: CircuitState.OPEN,
          failureCount: 10,
          successCount: 0,
          lastFailureTime: now,
          lastStateChange: now,
        })
      );

      const result = await circuitBreaker.checkState();

      expect(result.allowed).toBe(false);
      expect(result.state).toBe(CircuitState.OPEN);
      expect(result.message).toContain('Circuit breaker is OPEN');
    });

    it('should show retry time remaining in message', async () => {
      const now = Date.now();
      mockRedisClient.get.mockResolvedValue(
        JSON.stringify({
          state: CircuitState.OPEN,
          failureCount: 10,
          successCount: 0,
          lastFailureTime: now,
          lastStateChange: now,
        })
      );

      const result = await circuitBreaker.checkState();

      expect(result.message).toContain('Retry in');
      expect(result.message).toContain('s');
    });
  });

  describe('OPEN -> HALF_OPEN transition', () => {
    it('should transition to HALF_OPEN after 2 minute timeout', async () => {
      const twoMinutesAgo = Date.now() - 2 * 60 * 1000;
      mockRedisClient.get.mockResolvedValue(
        JSON.stringify({
          state: CircuitState.OPEN,
          failureCount: 10,
          successCount: 0,
          lastFailureTime: twoMinutesAgo,
          lastStateChange: twoMinutesAgo,
        })
      );
      mockRedisClient.set.mockResolvedValue('OK');

      const result = await circuitBreaker.checkState();

      expect(result.allowed).toBe(true);
      expect(result.state).toBe(CircuitState.HALF_OPEN);
      expect(result.message).toContain('attempting recovery');
    });

    it('should save HALF_OPEN state to Redis after timeout', async () => {
      const twoMinutesAgo = Date.now() - 2 * 60 * 1000;
      mockRedisClient.get.mockResolvedValue(
        JSON.stringify({
          state: CircuitState.OPEN,
          failureCount: 10,
          successCount: 0,
          lastFailureTime: twoMinutesAgo,
          lastStateChange: twoMinutesAgo,
        })
      );
      mockRedisClient.set.mockResolvedValue('OK');

      await circuitBreaker.checkState();

      expect(mockRedisClient.set).toHaveBeenCalledWith(
        'circuit-breaker:test-breaker',
        expect.stringContaining('"state":"HALF_OPEN"')
      );
    });

    it('should reset success count when transitioning to HALF_OPEN', async () => {
      const twoMinutesAgo = Date.now() - 2 * 60 * 1000;
      mockRedisClient.get.mockResolvedValue(
        JSON.stringify({
          state: CircuitState.OPEN,
          failureCount: 10,
          successCount: 5,
          lastFailureTime: twoMinutesAgo,
          lastStateChange: twoMinutesAgo,
        })
      );
      mockRedisClient.set.mockResolvedValue('OK');

      await circuitBreaker.checkState();

      expect(mockRedisClient.set).toHaveBeenCalledWith(
        'circuit-breaker:test-breaker',
        expect.stringContaining('"successCount":0')
      );
    });

    it('should not transition if timeout has not elapsed', async () => {
      const oneMinuteAgo = Date.now() - 60 * 1000;
      mockRedisClient.get.mockResolvedValue(
        JSON.stringify({
          state: CircuitState.OPEN,
          failureCount: 10,
          successCount: 0,
          lastFailureTime: oneMinuteAgo,
          lastStateChange: oneMinuteAgo,
        })
      );

      const result = await circuitBreaker.checkState();

      expect(result.allowed).toBe(false);
      expect(result.state).toBe(CircuitState.OPEN);
    });
  });

  describe('HALF_OPEN -> CLOSED transition', () => {
    it('should remain HALF_OPEN after 1 success', async () => {
      mockRedisClient.get.mockResolvedValue(
        JSON.stringify({
          state: CircuitState.HALF_OPEN,
          failureCount: 0,
          successCount: 0,
          lastFailureTime: null,
          lastStateChange: Date.now(),
        })
      );
      mockRedisClient.set.mockResolvedValue('OK');

      const result = await circuitBreaker.recordSuccess();

      expect(result.state).toBe(CircuitState.HALF_OPEN);
    });

    it('should remain HALF_OPEN after 2 successes', async () => {
      mockRedisClient.get.mockResolvedValue(
        JSON.stringify({
          state: CircuitState.HALF_OPEN,
          failureCount: 0,
          successCount: 1,
          lastFailureTime: null,
          lastStateChange: Date.now(),
        })
      );
      mockRedisClient.set.mockResolvedValue('OK');

      const result = await circuitBreaker.recordSuccess();

      expect(result.state).toBe(CircuitState.HALF_OPEN);
    });

    it('should transition to CLOSED after 3 consecutive successes', async () => {
      mockRedisClient.get.mockResolvedValue(
        JSON.stringify({
          state: CircuitState.HALF_OPEN,
          failureCount: 0,
          successCount: 2,
          lastFailureTime: null,
          lastStateChange: Date.now(),
        })
      );
      mockRedisClient.set.mockResolvedValue('OK');

      const result = await circuitBreaker.recordSuccess();

      expect(result.state).toBe(CircuitState.CLOSED);
      expect(result.message).toContain('service recovered');
    });

    it('should save CLOSED state to Redis after success threshold', async () => {
      mockRedisClient.get.mockResolvedValue(
        JSON.stringify({
          state: CircuitState.HALF_OPEN,
          failureCount: 0,
          successCount: 2,
          lastFailureTime: null,
          lastStateChange: Date.now(),
        })
      );
      mockRedisClient.set.mockResolvedValue('OK');

      await circuitBreaker.recordSuccess();

      expect(mockRedisClient.set).toHaveBeenCalledWith(
        'circuit-breaker:test-breaker',
        expect.stringContaining('"state":"CLOSED"')
      );
    });

    it('should reset success count when transitioning to CLOSED', async () => {
      mockRedisClient.get.mockResolvedValue(
        JSON.stringify({
          state: CircuitState.HALF_OPEN,
          failureCount: 0,
          successCount: 2,
          lastFailureTime: null,
          lastStateChange: Date.now(),
        })
      );
      mockRedisClient.set.mockResolvedValue('OK');

      await circuitBreaker.recordSuccess();

      expect(mockRedisClient.set).toHaveBeenCalledWith(
        'circuit-breaker:test-breaker',
        expect.stringContaining('"successCount":0')
      );
    });
  });

  describe('HALF_OPEN -> OPEN transition', () => {
    it('should transition to OPEN on any failure in HALF_OPEN state', async () => {
      mockRedisClient.get.mockResolvedValue(
        JSON.stringify({
          state: CircuitState.HALF_OPEN,
          failureCount: 0,
          successCount: 1,
          lastFailureTime: null,
          lastStateChange: Date.now(),
        })
      );
      mockRedisClient.set.mockResolvedValue('OK');

      const result = await circuitBreaker.recordFailure();

      expect(result.state).toBe(CircuitState.OPEN);
      expect(result.message).toContain('recovery attempt failed');
    });

    it('should save OPEN state to Redis after failure in HALF_OPEN', async () => {
      mockRedisClient.get.mockResolvedValue(
        JSON.stringify({
          state: CircuitState.HALF_OPEN,
          failureCount: 0,
          successCount: 2,
          lastFailureTime: null,
          lastStateChange: Date.now(),
        })
      );
      mockRedisClient.set.mockResolvedValue('OK');

      await circuitBreaker.recordFailure();

      expect(mockRedisClient.set).toHaveBeenCalledWith(
        'circuit-breaker:test-breaker',
        expect.stringContaining('"state":"OPEN"')
      );
    });

    it('should reset success count when transitioning back to OPEN', async () => {
      mockRedisClient.get.mockResolvedValue(
        JSON.stringify({
          state: CircuitState.HALF_OPEN,
          failureCount: 0,
          successCount: 2,
          lastFailureTime: null,
          lastStateChange: Date.now(),
        })
      );
      mockRedisClient.set.mockResolvedValue('OK');

      await circuitBreaker.recordFailure();

      expect(mockRedisClient.set).toHaveBeenCalledWith(
        'circuit-breaker:test-breaker',
        expect.stringContaining('"successCount":0')
      );
    });
  });

  describe('reset()', () => {
    it('should reset circuit breaker to CLOSED state', async () => {
      mockRedisClient.get.mockResolvedValue(
        JSON.stringify({
          state: CircuitState.OPEN,
          failureCount: 15,
          successCount: 0,
          lastFailureTime: Date.now(),
          lastStateChange: Date.now(),
        })
      );
      mockRedisClient.set.mockResolvedValue('OK');

      await circuitBreaker.reset();

      expect(mockRedisClient.set).toHaveBeenCalledWith(
        'circuit-breaker:test-breaker',
        expect.stringContaining('"state":"CLOSED"')
      );
    });

    it('should reset failure count to 0', async () => {
      mockRedisClient.set.mockResolvedValue('OK');

      await circuitBreaker.reset();

      expect(mockRedisClient.set).toHaveBeenCalledWith(
        'circuit-breaker:test-breaker',
        expect.stringContaining('"failureCount":0')
      );
    });

    it('should reset success count to 0', async () => {
      mockRedisClient.set.mockResolvedValue('OK');

      await circuitBreaker.reset();

      expect(mockRedisClient.set).toHaveBeenCalledWith(
        'circuit-breaker:test-breaker',
        expect.stringContaining('"successCount":0')
      );
    });

    it('should set lastFailureTime to null', async () => {
      mockRedisClient.set.mockResolvedValue('OK');

      await circuitBreaker.reset();

      expect(mockRedisClient.set).toHaveBeenCalledWith(
        'circuit-breaker:test-breaker',
        expect.stringContaining('"lastFailureTime":null')
      );
    });

    it('should handle Redis errors gracefully during reset', async () => {
      // saveState catches errors internally, so reset() should complete without throwing
      mockRedisClient.set.mockRejectedValue(new Error('Redis connection failed'));

      // Should not throw - saveState catches errors internally
      await expect(circuitBreaker.reset()).resolves.toBeUndefined();
    });
  });

  describe('getStatus()', () => {
    it('should return current state from Redis', async () => {
      const state = {
        state: CircuitState.HALF_OPEN,
        failureCount: 5,
        successCount: 1,
        lastFailureTime: Date.now() - 60000,
        lastStateChange: Date.now() - 120000,
      };
      mockRedisClient.get.mockResolvedValue(JSON.stringify(state));

      const result = await circuitBreaker.getStatus();

      expect(result.state).toBe(CircuitState.HALF_OPEN);
      expect(result.failureCount).toBe(5);
      expect(result.successCount).toBe(1);
    });

    it('should return default state if Redis returns null', async () => {
      mockRedisClient.get.mockResolvedValue(null);

      const result = await circuitBreaker.getStatus();

      expect(result.state).toBe(CircuitState.CLOSED);
      expect(result.failureCount).toBe(0);
      expect(result.successCount).toBe(0);
    });
  });

  describe('CLOSED state success behavior', () => {
    it('should reset failure count on success in CLOSED state', async () => {
      mockRedisClient.get.mockResolvedValue(
        JSON.stringify({
          state: CircuitState.CLOSED,
          failureCount: 5,
          successCount: 0,
          lastFailureTime: Date.now(),
          lastStateChange: Date.now(),
        })
      );
      mockRedisClient.set.mockResolvedValue('OK');

      await circuitBreaker.recordSuccess();

      expect(mockRedisClient.set).toHaveBeenCalledWith(
        'circuit-breaker:test-breaker',
        expect.stringContaining('"failureCount":0')
      );
    });

    it('should remain in CLOSED state after success', async () => {
      mockRedisClient.get.mockResolvedValue(
        JSON.stringify({
          state: CircuitState.CLOSED,
          failureCount: 5,
          successCount: 0,
          lastFailureTime: null,
          lastStateChange: Date.now(),
        })
      );
      mockRedisClient.set.mockResolvedValue('OK');

      const result = await circuitBreaker.recordSuccess();

      expect(result.state).toBe(CircuitState.CLOSED);
    });
  });

  describe('error handling - fail-open behavior', () => {
    it('should allow requests when Redis get fails during checkState', async () => {
      // loadState catches Redis errors internally and returns default state
      mockRedisClient.get.mockRejectedValue(new Error('Redis connection failed'));

      const result = await circuitBreaker.checkState();

      // Since loadState() catches errors and returns default state, checkState succeeds
      expect(result.allowed).toBe(true);
      expect(result.state).toBe(CircuitState.CLOSED);
      // No message because the error was handled in loadState()
      expect(result.message).toBeUndefined();
    });

    it('should return CLOSED state when Redis get fails during recordSuccess', async () => {
      // loadState catches Redis errors internally and returns default state
      mockRedisClient.get.mockRejectedValue(new Error('Redis connection failed'));
      mockRedisClient.set.mockResolvedValue('OK');

      const result = await circuitBreaker.recordSuccess();

      // Since loadState() catches errors, recordSuccess gets default state and saves it
      expect(result.state).toBe(CircuitState.CLOSED);
      // No error message because operation completed with default state
      expect(result.message).toBeUndefined();
    });

    it('should return CLOSED state when Redis get fails during recordFailure', async () => {
      // loadState catches Redis errors internally and returns default state
      mockRedisClient.get.mockRejectedValue(new Error('Redis connection failed'));
      mockRedisClient.set.mockResolvedValue('OK');

      const result = await circuitBreaker.recordFailure();

      // Since loadState() catches errors, recordFailure gets default state
      // Default state has failureCount: 0, so after incrementing it becomes 1
      // This is below threshold (10), so it stays CLOSED
      expect(result.state).toBe(CircuitState.CLOSED);
    });

    it('should return default state when Redis get fails during getStatus', async () => {
      // loadState catches Redis errors internally and returns default state
      mockRedisClient.get.mockRejectedValue(new Error('Redis connection failed'));

      const result = await circuitBreaker.getStatus();

      expect(result.state).toBe(CircuitState.CLOSED);
      expect(result.failureCount).toBe(0);
      expect(result.successCount).toBe(0);
    });

    it('should handle Redis set failure gracefully during saveState', async () => {
      // loadState succeeds, but saveState fails
      mockRedisClient.get.mockResolvedValue(
        JSON.stringify({
          state: CircuitState.CLOSED,
          failureCount: 0,
          successCount: 0,
          lastFailureTime: null,
          lastStateChange: Date.now(),
        })
      );
      mockRedisClient.set.mockRejectedValue(new Error('Redis write failed'));

      // Should not throw - saveState catches errors internally
      const result = await circuitBreaker.recordSuccess();

      expect(result.state).toBe(CircuitState.CLOSED);
    });
  });

  describe('getCircuitBreaker singleton', () => {
    it('should return a CircuitBreaker instance', () => {
      const instance = getCircuitBreaker();

      expect(instance).toBeInstanceOf(CircuitBreaker);
    });

    it('should return the same instance on multiple calls', () => {
      const instance1 = getCircuitBreaker();
      const instance2 = getCircuitBreaker();

      expect(instance1).toBe(instance2);
    });
  });

  describe('Redis key naming', () => {
    it('should use correct Redis key for named circuit breaker', async () => {
      const namedBreaker = new CircuitBreaker('custom-service');
      mockRedisClient.get.mockResolvedValue(null);
      mockRedisClient.set.mockResolvedValue('OK');

      await namedBreaker.reset();

      expect(mockRedisClient.set).toHaveBeenCalledWith(
        'circuit-breaker:custom-service',
        expect.any(String)
      );
    });

    it('should use default name "scraper" when no name provided', async () => {
      const defaultBreaker = new CircuitBreaker();
      mockRedisClient.get.mockResolvedValue(null);
      mockRedisClient.set.mockResolvedValue('OK');

      await defaultBreaker.reset();

      expect(mockRedisClient.set).toHaveBeenCalledWith(
        'circuit-breaker:scraper',
        expect.any(String)
      );
    });
  });
});
