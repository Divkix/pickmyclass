/**
 * Circuit Breaker Pattern Implementation
 *
 * Protects against cascading failures when ASU site is down or slow.
 * Three states:
 * - CLOSED: Normal operation (allow all requests)
 * - OPEN: Failure threshold exceeded (reject all requests)
 * - HALF_OPEN: Testing if service recovered (allow limited requests)
 *
 * Example scenario:
 * - 10 scrapes fail in a row → Circuit opens (stops trying for 2 minutes)
 * - After 2 minutes → Circuit goes half-open (tries 1 request)
 * - If that succeeds → Circuit closes (back to normal)
 * - If that fails → Circuit opens again (wait another 2 minutes)
 */

enum CircuitState {
  CLOSED = 'CLOSED', // Normal operation
  OPEN = 'OPEN', // Too many failures, rejecting requests
  HALF_OPEN = 'HALF_OPEN', // Testing if service recovered
}

export interface CircuitBreakerOptions {
  failureThreshold: number // Number of failures before opening
  successThreshold: number // Number of successes to close from half-open
  timeout: number // Time in ms to wait before attempting half-open
}

export interface CircuitBreakerStats {
  state: string
  failures: number
  successes: number
  lastFailureTime: number | null
  nextAttemptTime: number | null
}

export class CircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED
  private failureCount: number = 0
  private successCount: number = 0
  private lastFailureTime: number | null = null
  private nextAttemptTime: number | null = null

  constructor(private options: CircuitBreakerOptions) {}

  /**
   * Execute function with circuit breaker protection
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    // Check if circuit is open
    if (this.state === CircuitState.OPEN) {
      // Check if timeout has elapsed
      if (this.nextAttemptTime && Date.now() >= this.nextAttemptTime) {
        console.log('[CircuitBreaker] Timeout elapsed, transitioning to HALF_OPEN')
        this.state = CircuitState.HALF_OPEN
        this.successCount = 0
      } else {
        const waitTime = this.nextAttemptTime
          ? Math.ceil((this.nextAttemptTime - Date.now()) / 1000)
          : 0
        throw new Error(
          `Circuit breaker is OPEN - ASU site may be down (retry in ${waitTime}s)`
        )
      }
    }

    try {
      const result = await fn()
      this.onSuccess()
      return result
    } catch (error) {
      this.onFailure()
      throw error
    }
  }

  /**
   * Handle successful execution
   */
  private onSuccess(): void {
    this.failureCount = 0

    if (this.state === CircuitState.HALF_OPEN) {
      this.successCount++
      console.log(
        `[CircuitBreaker] Success in HALF_OPEN state (${this.successCount}/${this.options.successThreshold})`
      )

      if (this.successCount >= this.options.successThreshold) {
        console.log('[CircuitBreaker] Success threshold reached, transitioning to CLOSED')
        this.state = CircuitState.CLOSED
        this.successCount = 0
        this.lastFailureTime = null
        this.nextAttemptTime = null
      }
    }
  }

  /**
   * Handle failed execution
   */
  private onFailure(): void {
    this.failureCount++
    this.lastFailureTime = Date.now()

    if (this.state === CircuitState.HALF_OPEN) {
      console.log('[CircuitBreaker] Failure in HALF_OPEN state, reopening circuit')
      this.state = CircuitState.OPEN
      this.nextAttemptTime = Date.now() + this.options.timeout
      this.successCount = 0
    } else if (this.failureCount >= this.options.failureThreshold) {
      console.log(
        `[CircuitBreaker] Failure threshold reached (${this.failureCount}/${this.options.failureThreshold}), opening circuit`
      )
      this.state = CircuitState.OPEN
      this.nextAttemptTime = Date.now() + this.options.timeout
    }
  }

  /**
   * Get current circuit breaker statistics
   */
  getStats(): CircuitBreakerStats {
    return {
      state: this.state,
      failures: this.failureCount,
      successes: this.successCount,
      lastFailureTime: this.lastFailureTime,
      nextAttemptTime: this.nextAttemptTime,
    }
  }

  /**
   * Manually reset circuit breaker to CLOSED state
   */
  reset(): void {
    console.log('[CircuitBreaker] Manual reset to CLOSED state')
    this.state = CircuitState.CLOSED
    this.failureCount = 0
    this.successCount = 0
    this.lastFailureTime = null
    this.nextAttemptTime = null
  }
}
