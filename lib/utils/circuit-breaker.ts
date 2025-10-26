/**
 * Circuit Breaker Pattern for External Service Calls
 *
 * Prevents cascading failures by temporarily blocking requests to failing services.
 * Implements three states: CLOSED (normal), OPEN (blocking), HALF_OPEN (testing).
 */

/**
 * Circuit breaker state
 */
export enum CircuitState {
  CLOSED = 'CLOSED', // Normal operation
  OPEN = 'OPEN', // Blocking requests (service is down)
  HALF_OPEN = 'HALF_OPEN', // Testing if service recovered
}

/**
 * Circuit breaker error with metadata
 */
export class CircuitBreakerError extends Error {
  circuitBreakerOpen: boolean

  constructor(message: string) {
    super(message)
    this.name = 'CircuitBreakerError'
    this.circuitBreakerOpen = true
  }
}

/**
 * Circuit breaker configuration
 */
export interface CircuitBreakerOptions {
  /**
   * Number of failures before opening circuit
   * @default 5
   */
  failureThreshold?: number

  /**
   * Time in milliseconds before attempting recovery (HALF_OPEN)
   * @default 60000 (1 minute)
   */
  resetTimeout?: number

  /**
   * Number of successful requests in HALF_OPEN before closing circuit
   * @default 2
   */
  successThreshold?: number

  /**
   * Request timeout in milliseconds
   * @default 30000 (30 seconds)
   */
  timeout?: number

  /**
   * Service name for logging
   */
  name: string
}

/**
 * Circuit breaker implementation
 */
export class CircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED
  private failureCount = 0
  private successCount = 0
  private lastFailureTime: number | null = null
  private readonly options: Required<CircuitBreakerOptions>

  constructor(options: CircuitBreakerOptions) {
    this.options = {
      failureThreshold: options.failureThreshold ?? 5,
      resetTimeout: options.resetTimeout ?? 60000,
      successThreshold: options.successThreshold ?? 2,
      timeout: options.timeout ?? 30000,
      name: options.name,
    }
  }

  /**
   * Execute a function with circuit breaker protection
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    // Check if circuit should transition from OPEN to HALF_OPEN
    if (this.state === CircuitState.OPEN) {
      if (
        this.lastFailureTime &&
        Date.now() - this.lastFailureTime >= this.options.resetTimeout
      ) {
        console.log(
          `[CircuitBreaker:${this.options.name}] Transitioning OPEN → HALF_OPEN (attempting recovery)`
        )
        this.state = CircuitState.HALF_OPEN
        this.successCount = 0
      } else {
        throw new CircuitBreakerError(
          `Circuit breaker is OPEN for ${this.options.name} (service unavailable)`
        )
      }
    }

    try {
      // Execute function with timeout
      const result = await this.executeWithTimeout(fn)

      // Handle success
      this.onSuccess()
      return result
    } catch (error) {
      // Handle failure
      this.onFailure()
      throw error
    }
  }

  /**
   * Execute function with timeout
   */
  private async executeWithTimeout<T>(fn: () => Promise<T>): Promise<T> {
    return Promise.race([
      fn(),
      new Promise<T>((_, reject) =>
        setTimeout(
          () => reject(new Error(`Request timeout after ${this.options.timeout}ms`)),
          this.options.timeout
        )
      ),
    ])
  }

  /**
   * Handle successful execution
   */
  private onSuccess(): void {
    this.failureCount = 0

    if (this.state === CircuitState.HALF_OPEN) {
      this.successCount++
      console.log(
        `[CircuitBreaker:${this.options.name}] Success in HALF_OPEN (${this.successCount}/${this.options.successThreshold})`
      )

      if (this.successCount >= this.options.successThreshold) {
        console.log(
          `[CircuitBreaker:${this.options.name}] Transitioning HALF_OPEN → CLOSED (service recovered)`
        )
        this.state = CircuitState.CLOSED
        this.successCount = 0
      }
    }
  }

  /**
   * Handle failed execution
   */
  private onFailure(): void {
    this.failureCount++
    this.lastFailureTime = Date.now()

    console.error(
      `[CircuitBreaker:${this.options.name}] Failure (${this.failureCount}/${this.options.failureThreshold})`
    )

    if (this.state === CircuitState.HALF_OPEN) {
      console.log(
        `[CircuitBreaker:${this.options.name}] Failed in HALF_OPEN, transitioning back to OPEN`
      )
      this.state = CircuitState.OPEN
      this.successCount = 0
    } else if (this.failureCount >= this.options.failureThreshold) {
      console.log(
        `[CircuitBreaker:${this.options.name}] Threshold reached, transitioning CLOSED → OPEN`
      )
      this.state = CircuitState.OPEN
    }
  }

  /**
   * Get current state
   */
  getState(): CircuitState {
    return this.state
  }

  /**
   * Get failure count
   */
  getFailureCount(): number {
    return this.failureCount
  }

  /**
   * Force reset to CLOSED state (for testing/admin)
   */
  reset(): void {
    console.log(`[CircuitBreaker:${this.options.name}] Manual reset to CLOSED`)
    this.state = CircuitState.CLOSED
    this.failureCount = 0
    this.successCount = 0
    this.lastFailureTime = null
  }

  /**
   * Get circuit breaker status for monitoring
   */
  getStatus(): {
    name: string
    state: CircuitState
    failureCount: number
    successCount: number
    lastFailureTime: number | null
  } {
    return {
      name: this.options.name,
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
      lastFailureTime: this.lastFailureTime,
    }
  }
}

/**
 * Singleton scraper circuit breaker instance
 */
let scraperCircuitBreaker: CircuitBreaker | null = null

/**
 * Get or create scraper circuit breaker
 */
export function getScraperCircuitBreaker(): CircuitBreaker {
  if (!scraperCircuitBreaker) {
    scraperCircuitBreaker = new CircuitBreaker({
      name: 'ASU-Scraper',
      failureThreshold: 10, // Higher threshold since we have high volume
      resetTimeout: 120000, // 2 minutes
      successThreshold: 3, // Require 3 successes to close
      timeout: 45000, // 45 second timeout (scraping can be slow)
    })
  }
  return scraperCircuitBreaker
}
