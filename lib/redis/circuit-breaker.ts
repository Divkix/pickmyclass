/**
 * Redis-based Circuit Breaker
 *
 * Provides distributed circuit breaker state management using Redis.
 * All instances share the same state, enabling coordination across
 * multiple processes or servers.
 *
 * State Machine:
 * - CLOSED: Normal operation, counting failures
 * - OPEN: Circuit tripped, blocking requests, waiting for timeout
 * - HALF_OPEN: Testing recovery, allowing limited requests
 *
 * Configuration (matching Cloudflare DO implementation):
 * - Failure threshold: 10 failures -> OPEN
 * - Reset timeout: 2 minutes before attempting recovery
 * - Success threshold: 3 successes in HALF_OPEN -> CLOSED
 */

import { getRedisClient } from './client';

/**
 * Circuit breaker states
 */
export enum CircuitState {
  CLOSED = 'CLOSED',
  OPEN = 'OPEN',
  HALF_OPEN = 'HALF_OPEN',
}

/**
 * Circuit breaker state stored in Redis
 */
export interface CircuitBreakerState {
  state: CircuitState;
  failureCount: number;
  successCount: number;
  lastFailureTime: number | null;
  lastStateChange: number;
}

/**
 * Response from checkState operation
 */
export interface CheckStateResult {
  allowed: boolean;
  state: CircuitState;
  message?: string;
}

/**
 * Response from recordSuccess/recordFailure operations
 */
export interface RecordResult {
  state: CircuitState;
  message?: string;
}

/**
 * Redis-based Circuit Breaker class
 *
 * Stores state as JSON in a Redis key. Uses atomic operations where possible.
 */
export class CircuitBreaker {
  private readonly redisKey: string;
  private readonly FAILURE_THRESHOLD = 10;
  private readonly RESET_TIMEOUT_MS = 2 * 60 * 1000; // 2 minutes
  private readonly SUCCESS_THRESHOLD = 3;

  /**
   * Create a new CircuitBreaker instance
   *
   * @param name - Identifier for this circuit breaker (default: 'scraper')
   */
  constructor(name: string = 'scraper') {
    this.redisKey = `circuit-breaker:${name}`;
  }

  /**
   * Get default state for initialization
   */
  private getDefaultState(): CircuitBreakerState {
    return {
      state: CircuitState.CLOSED,
      failureCount: 0,
      successCount: 0,
      lastFailureTime: null,
      lastStateChange: Date.now(),
    };
  }

  /**
   * Load current state from Redis
   */
  private async loadState(): Promise<CircuitBreakerState> {
    const redis = getRedisClient();
    const data = await redis.get(this.redisKey);

    if (!data) {
      return this.getDefaultState();
    }

    try {
      return JSON.parse(data) as CircuitBreakerState;
    } catch {
      console.error('[CircuitBreaker] Failed to parse state, resetting');
      return this.getDefaultState();
    }
  }

  /**
   * Save state to Redis
   */
  private async saveState(state: CircuitBreakerState): Promise<void> {
    const redis = getRedisClient();
    await redis.set(this.redisKey, JSON.stringify(state));
  }

  /**
   * Check if a request is allowed based on circuit state
   *
   * @returns Object with allowed flag, current state, and optional message
   */
  async checkState(): Promise<CheckStateResult> {
    const state = await this.loadState();

    // Check if circuit should transition from OPEN to HALF_OPEN
    if (state.state === CircuitState.OPEN) {
      if (
        state.lastFailureTime !== null &&
        Date.now() - state.lastFailureTime >= this.RESET_TIMEOUT_MS
      ) {
        console.log('[CircuitBreaker] Transitioning OPEN -> HALF_OPEN (attempting recovery)');
        state.state = CircuitState.HALF_OPEN;
        state.successCount = 0;
        state.lastStateChange = Date.now();
        await this.saveState(state);

        return {
          allowed: true,
          state: CircuitState.HALF_OPEN,
          message: 'Circuit breaker attempting recovery',
        };
      }

      const timeUntilRetry = this.RESET_TIMEOUT_MS - (Date.now() - state.lastFailureTime!);
      return {
        allowed: false,
        state: CircuitState.OPEN,
        message: `Circuit breaker is OPEN. Retry in ${Math.ceil(timeUntilRetry / 1000)}s`,
      };
    }

    return {
      allowed: true,
      state: state.state,
    };
  }

  /**
   * Record a successful request
   *
   * In HALF_OPEN state, increments success counter and transitions to CLOSED
   * after reaching success threshold.
   * In CLOSED state, resets failure counter.
   */
  async recordSuccess(): Promise<RecordResult> {
    const state = await this.loadState();

    state.failureCount = 0;

    if (state.state === CircuitState.HALF_OPEN) {
      state.successCount++;
      console.log(
        `[CircuitBreaker] Success in HALF_OPEN (${state.successCount}/${this.SUCCESS_THRESHOLD})`
      );

      if (state.successCount >= this.SUCCESS_THRESHOLD) {
        console.log('[CircuitBreaker] Transitioning HALF_OPEN -> CLOSED (service recovered)');
        state.state = CircuitState.CLOSED;
        state.successCount = 0;
        state.lastStateChange = Date.now();
        await this.saveState(state);

        return {
          state: CircuitState.CLOSED,
          message: 'Circuit breaker closed - service recovered',
        };
      }
    }

    await this.saveState(state);
    return {
      state: state.state,
    };
  }

  /**
   * Record a failed request
   *
   * Increments failure counter and transitions to OPEN if threshold is reached.
   * In HALF_OPEN state, immediately transitions back to OPEN on any failure.
   */
  async recordFailure(): Promise<RecordResult> {
    const state = await this.loadState();

    state.failureCount++;
    state.lastFailureTime = Date.now();

    console.error(
      `[CircuitBreaker] Failure recorded (${state.failureCount}/${this.FAILURE_THRESHOLD})`
    );

    if (state.state === CircuitState.HALF_OPEN) {
      console.log('[CircuitBreaker] Failed in HALF_OPEN, transitioning back to OPEN');
      state.state = CircuitState.OPEN;
      state.successCount = 0;
      state.lastStateChange = Date.now();
      await this.saveState(state);

      return {
        state: CircuitState.OPEN,
        message: 'Circuit breaker opened - recovery attempt failed',
      };
    }

    if (state.failureCount >= this.FAILURE_THRESHOLD) {
      console.log('[CircuitBreaker] Threshold reached, transitioning CLOSED -> OPEN');
      state.state = CircuitState.OPEN;
      state.lastStateChange = Date.now();
      await this.saveState(state);

      return {
        state: CircuitState.OPEN,
        message: 'Circuit breaker opened - failure threshold exceeded',
      };
    }

    await this.saveState(state);
    return {
      state: state.state,
    };
  }

  /**
   * Get current circuit breaker status
   *
   * Used for monitoring and health checks.
   */
  async getStatus(): Promise<CircuitBreakerState> {
    return this.loadState();
  }

  /**
   * Force reset to CLOSED state
   *
   * For admin/testing purposes only.
   */
  async reset(): Promise<void> {
    console.log('[CircuitBreaker] Manual reset to CLOSED');
    const state = this.getDefaultState();
    await this.saveState(state);
  }
}

/**
 * Default circuit breaker instance for the scraper service
 */
let defaultCircuitBreaker: CircuitBreaker | null = null;

/**
 * Get the default circuit breaker instance (singleton)
 *
 * @returns CircuitBreaker instance for the scraper service
 */
export function getCircuitBreaker(): CircuitBreaker {
  if (!defaultCircuitBreaker) {
    defaultCircuitBreaker = new CircuitBreaker('scraper');
  }
  return defaultCircuitBreaker;
}
