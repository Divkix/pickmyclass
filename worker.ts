/**
 * Custom Cloudflare Worker
 *
 * This wraps the OpenNext-generated worker to add a scheduled handler for cron triggers.
 * The fetch handler routes HTTP requests to the Next.js app, while the scheduled handler
 * executes cron jobs on a defined schedule.
 */

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - `.open-next/worker.js` is generated at build time
import { default as handler } from './.open-next/worker.js'

import { DurableObject } from 'cloudflare:workers'
import type { ClassCheckMessage, QueueMessageBatch } from './lib/types/queue'

/**
 * Cloudflare Workers environment bindings
 */
interface Env {
  ASSETS: Fetcher
  CRON_SECRET: string
  CLASS_CHECK_QUEUE: Queue<ClassCheckMessage>
  CIRCUIT_BREAKER_DO: DurableObjectNamespace
  NEXT_PUBLIC_SUPABASE_URL: string
  NEXT_PUBLIC_SUPABASE_ANON_KEY: string
  SUPABASE_SERVICE_ROLE_KEY: string
  SCRAPER_URL: string
  SCRAPER_SECRET_TOKEN: string
  RESEND_API_KEY?: string
  NOTIFICATION_FROM_EMAIL?: string
}

/**
 * Cloudflare Workers Fetcher type (for asset serving)
 */
interface Fetcher {
  fetch(request: Request): Promise<Response>
}

/**
 * Circuit Breaker State
 */
enum CircuitState {
  CLOSED = 'CLOSED', // Normal operation
  OPEN = 'OPEN', // Blocking requests (service is down)
  HALF_OPEN = 'HALF_OPEN', // Testing if service recovered
}

/**
 * Circuit Breaker State Interface
 */
interface CircuitBreakerState {
  state: CircuitState
  failureCount: number
  successCount: number
  lastFailureTime: number | null
  lastStateChange: number
}

/**
 * Durable Object for globally coordinated circuit breaker
 *
 * This provides distributed state management for the circuit breaker across
 * all Worker isolates. Instead of each Worker having its own singleton state,
 * all Workers share this single Durable Object instance.
 *
 * **Architecture:**
 * - Single instance per circuit breaker (identified by name)
 * - Persistent state via Durable Object storage
 * - Handles concurrent requests from 100+ Worker isolates
 * - Atomic state transitions prevent race conditions
 *
 * **Configuration:**
 * - Failure threshold: 10 failures → OPEN
 * - Reset timeout: 2 minutes before attempting recovery
 * - Success threshold: 3 successes in HALF_OPEN → CLOSED
 *
 * **State Transitions:**
 * - CLOSED: Normal operation, failures increment counter
 * - OPEN: Blocking all requests, waiting for reset timeout
 * - HALF_OPEN: Testing recovery, one failure → OPEN, 3 successes → CLOSED
 */
export class CircuitBreakerDO extends DurableObject<Cloudflare.Env> {
  private state: CircuitBreakerState
  private readonly FAILURE_THRESHOLD = 10
  private readonly RESET_TIMEOUT_MS = 120000 // 2 minutes
  private readonly SUCCESS_THRESHOLD = 3

  /**
   * Constructor - loads persistent state from storage
   *
   * Uses ctx.blockConcurrencyWhile() to ensure state is loaded before
   * processing any requests. This prevents race conditions during initialization.
   */
  constructor(ctx: DurableObjectState, env: Cloudflare.Env) {
    super(ctx, env)

    // Initialize default state
    this.state = {
      state: CircuitState.CLOSED,
      failureCount: 0,
      successCount: 0,
      lastFailureTime: null,
      lastStateChange: Date.now(),
    }

    // Load state from storage asynchronously
    // blockConcurrencyWhile ensures this completes before handling requests
    this.ctx.blockConcurrencyWhile(async () => {
      const stored = await this.ctx.storage.get<CircuitBreakerState>('state')
      if (stored) {
        this.state = stored
        console.log('[CircuitBreakerDO] Loaded state from storage:', this.state)
      } else {
        console.log('[CircuitBreakerDO] Initialized with default state')
      }
    })
  }

  /**
   * Persist current state to durable storage
   */
  private async persist(): Promise<void> {
    await this.ctx.storage.put('state', this.state)
  }

  /**
   * Check if a request is allowed based on circuit state
   *
   * @returns {boolean} true if request should proceed, false if circuit is OPEN
   */
  async checkState(): Promise<{
    allowed: boolean
    state: CircuitState
    message?: string
  }> {
    // Check if circuit should transition from OPEN to HALF_OPEN
    if (this.state.state === CircuitState.OPEN) {
      if (
        this.state.lastFailureTime &&
        Date.now() - this.state.lastFailureTime >= this.RESET_TIMEOUT_MS
      ) {
        console.log('[CircuitBreakerDO] Transitioning OPEN → HALF_OPEN (attempting recovery)')
        this.state.state = CircuitState.HALF_OPEN
        this.state.successCount = 0
        this.state.lastStateChange = Date.now()
        await this.persist()

        return {
          allowed: true,
          state: CircuitState.HALF_OPEN,
          message: 'Circuit breaker attempting recovery',
        }
      } else {
        const timeUntilRetry = this.RESET_TIMEOUT_MS - (Date.now() - this.state.lastFailureTime!)
        return {
          allowed: false,
          state: CircuitState.OPEN,
          message: `Circuit breaker is OPEN. Retry in ${Math.ceil(timeUntilRetry / 1000)}s`,
        }
      }
    }

    return {
      allowed: true,
      state: this.state.state,
    }
  }

  /**
   * Record a successful request
   *
   * In HALF_OPEN state, increments success counter and transitions to CLOSED
   * after reaching success threshold.
   * In CLOSED state, resets failure counter.
   */
  async recordSuccess(): Promise<{
    state: CircuitState
    message?: string
  }> {
    this.state.failureCount = 0

    if (this.state.state === CircuitState.HALF_OPEN) {
      this.state.successCount++
      console.log(
        `[CircuitBreakerDO] Success in HALF_OPEN (${this.state.successCount}/${this.SUCCESS_THRESHOLD})`
      )

      if (this.state.successCount >= this.SUCCESS_THRESHOLD) {
        console.log('[CircuitBreakerDO] Transitioning HALF_OPEN → CLOSED (service recovered)')
        this.state.state = CircuitState.CLOSED
        this.state.successCount = 0
        this.state.lastStateChange = Date.now()
        await this.persist()

        return {
          state: CircuitState.CLOSED,
          message: 'Circuit breaker closed - service recovered',
        }
      }
    }

    await this.persist()
    return {
      state: this.state.state,
    }
  }

  /**
   * Record a failed request
   *
   * Increments failure counter and transitions to OPEN if threshold is reached.
   * In HALF_OPEN state, immediately transitions back to OPEN on any failure.
   */
  async recordFailure(): Promise<{
    state: CircuitState
    message?: string
  }> {
    this.state.failureCount++
    this.state.lastFailureTime = Date.now()

    console.error(
      `[CircuitBreakerDO] Failure recorded (${this.state.failureCount}/${this.FAILURE_THRESHOLD})`
    )

    if (this.state.state === CircuitState.HALF_OPEN) {
      console.log('[CircuitBreakerDO] Failed in HALF_OPEN, transitioning back to OPEN')
      this.state.state = CircuitState.OPEN
      this.state.successCount = 0
      this.state.lastStateChange = Date.now()
      await this.persist()

      return {
        state: CircuitState.OPEN,
        message: 'Circuit breaker opened - recovery attempt failed',
      }
    } else if (this.state.failureCount >= this.FAILURE_THRESHOLD) {
      console.log('[CircuitBreakerDO] Threshold reached, transitioning CLOSED → OPEN')
      this.state.state = CircuitState.OPEN
      this.state.lastStateChange = Date.now()
      await this.persist()

      return {
        state: CircuitState.OPEN,
        message: 'Circuit breaker opened - failure threshold exceeded',
      }
    }

    await this.persist()
    return {
      state: this.state.state,
    }
  }

  /**
   * Get current circuit breaker status
   *
   * Used for monitoring and health checks.
   */
  async getStatus(): Promise<CircuitBreakerState> {
    return {
      ...this.state,
    }
  }

  /**
   * Force reset to CLOSED state
   *
   * For admin/testing purposes only.
   */
  async reset(): Promise<void> {
    console.log('[CircuitBreakerDO] Manual reset to CLOSED')
    this.state = {
      state: CircuitState.CLOSED,
      failureCount: 0,
      successCount: 0,
      lastFailureTime: null,
      lastStateChange: Date.now(),
    }
    await this.persist()
  }

  /**
   * Fetch handler - provides HTTP API for circuit breaker operations
   */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    switch (url.pathname) {
      case '/check':
        return Response.json(await this.checkState())

      case '/success':
        if (request.method !== 'POST') {
          return new Response('Method not allowed', { status: 405 })
        }
        return Response.json(await this.recordSuccess())

      case '/failure':
        if (request.method !== 'POST') {
          return new Response('Method not allowed', { status: 405 })
        }
        return Response.json(await this.recordFailure())

      case '/status':
        return Response.json(await this.getStatus())

      case '/reset':
        if (request.method !== 'POST') {
          return new Response('Method not allowed', { status: 405 })
        }
        await this.reset()
        return Response.json({ success: true, message: 'Circuit breaker reset' })

      default:
        return new Response('Not found', { status: 404 })
    }
  }
}

/**
 * Export the worker with fetch, scheduled, and queue handlers
 */
export default {
  /**
   * HTTP request handler - routes to Next.js app via OpenNext
   */
  fetch: handler.fetch,

  /**
   * Scheduled handler - triggered by Cloudflare Cron
   *
   * Configured in wrangler.jsonc:
   * "triggers": { "crons": ["0,30 * * * *"] } // Every 30 minutes
   */
  async scheduled(
    event: ScheduledEvent,
    env: Env,
    ctx: ExecutionContext
  ): Promise<void> {
    const startTime = Date.now()
    console.log('[Scheduled] Cron triggered at:', new Date(event.scheduledTime).toISOString())
    console.log('[Scheduled] Cron pattern:', event.cron)

    try {
      // Make internal HTTP request to the Next.js API route
      // This allows us to reuse the same logic whether triggered by cron or manually
      const request = new Request('http://localhost/api/cron', {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${env.CRON_SECRET}`,
          'User-Agent': 'Cloudflare-Workers-Cron',
        },
      })

      // Execute the cron job and await completion
      // Environment bindings are passed via handler.fetch(request, env, ctx)
      // and accessed in API routes via getCloudflareContext()
      const response = await handler.fetch(request, env, ctx)
      const body = await response.text()
      const duration = Date.now() - startTime

      console.log('[Scheduled] Cron completed in', duration, 'ms')
      console.log('[Scheduled] Response:', body)

      if (!response.ok) {
        console.error('[Scheduled] Cron returned error status:', response.status)
      }
    } catch (error) {
      const duration = Date.now() - startTime
      console.error('[Scheduled] Fatal error after', duration, 'ms:', error)
    }
  },

  /**
   * Queue consumer handler - processes class section check messages
   *
   * Receives batches of up to 10 messages (configured in wrangler.jsonc)
   * Each message represents a single section to check for changes.
   */
  async queue(
    batch: QueueMessageBatch<ClassCheckMessage>,
    env: Env,
    ctx: ExecutionContext
  ): Promise<void> {
    const startTime = Date.now()
    console.log(
      `[Queue] Processing batch of ${batch.messages.length} messages from queue: ${batch.queue}`
    )

    // Process all messages in the batch concurrently
    const results = await Promise.allSettled(
      batch.messages.map(async (message) => {
        const msgStartTime = Date.now()
        try {
          // Make internal HTTP request to the section processor API route
          const request = new Request('http://localhost/api/queue/process-section', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${env.CRON_SECRET}`,
              'Content-Type': 'application/json',
              'User-Agent': 'Cloudflare-Workers-Queue',
            },
            body: JSON.stringify(message.body),
          })

          // Pass environment bindings
          // @ts-expect-error - NextRequest doesn't have env property, but we add it
          request.env = env

          const response = await handler.fetch(request, env, ctx)
          const result = await response.json()

          const duration = Date.now() - msgStartTime

          if (response.ok) {
            console.log(
              `[Queue] ✅ Processed ${message.body.class_nbr} in ${duration}ms:`,
              result
            )
            message.ack() // Acknowledge successful processing
          } else {
            console.error(
              `[Queue] ❌ Failed ${message.body.class_nbr} in ${duration}ms:`,
              result
            )
            message.retry() // Retry on failure
          }

          return { success: response.ok, class_nbr: message.body.class_nbr, duration }
        } catch (error) {
          const duration = Date.now() - msgStartTime
          console.error(
            `[Queue] ❌ Error processing ${message.body.class_nbr} in ${duration}ms:`,
            error
          )
          message.retry() // Retry on error
          return { success: false, class_nbr: message.body.class_nbr, duration, error }
        }
      })
    )

    // Log batch summary
    const successful = results.filter((r) => r.status === 'fulfilled' && r.value.success).length
    const failed = results.length - successful
    const totalDuration = Date.now() - startTime

    console.log(
      `[Queue] Batch complete in ${totalDuration}ms: ${successful} successful, ${failed} failed`
    )
  },
} satisfies ExportedHandler<Env>

/**
 * Cloudflare Workers cron event type
 */
interface ScheduledEvent {
  /** Unix timestamp (milliseconds) when the cron was scheduled to run */
  scheduledTime: number
  /** The cron pattern that triggered this event (e.g., "0 * * * *") */
  cron: string
}

/**
 * Cloudflare Workers exported handler type
 */
interface ExportedHandler<Env = unknown> {
  fetch?: (request: Request, env: Env, ctx: ExecutionContext) => Response | Promise<Response>
  scheduled?: (event: ScheduledEvent, env: Env, ctx: ExecutionContext) => void | Promise<void>
  queue?: (batch: QueueMessageBatch, env: Env, ctx: ExecutionContext) => void | Promise<void>
}
