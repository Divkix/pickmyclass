/**
 * Custom Cloudflare Worker
 *
 * This wraps the OpenNext-generated worker to add a scheduled handler for cron triggers.
 * The fetch handler routes HTTP requests to the Next.js app, while the scheduled handler
 * executes cron jobs on a defined schedule.
 */

// @ts-ignore `.open-next/worker.js` is generated at build time
import { default as handler } from './.open-next/worker.js'

/**
 * Cloudflare Workers environment bindings
 */
interface Env {
  HYPERDRIVE: Hyperdrive
  ASSETS: Fetcher
  KV: KVNamespace
}

/**
 * Cloudflare Hyperdrive type (connection pooling for databases)
 */
interface Hyperdrive {
  connectionString: string
}

/**
 * Cloudflare Workers Fetcher type (for asset serving)
 */
interface Fetcher {
  fetch(request: Request): Promise<Response>
}

/**
 * Export the worker with both fetch and scheduled handlers
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
   * "triggers": { "crons": ["0 * * * *"] } // Every hour
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
          'X-Cloudflare-Cron': 'true', // Internal auth header
          'User-Agent': 'Cloudflare-Workers-Cron',
        },
      })

      // Add Cloudflare env to request for Hyperdrive access
      // @ts-expect-error - NextRequest doesn't have env property, but we add it
      request.env = env

      // Execute the cron job (don't await - let it run in background)
      ctx.waitUntil(
        handler
          .fetch(request, env, ctx)
          .then((response: Response) => response.text())
          .then((body: string) => {
            const duration = Date.now() - startTime
            console.log('[Scheduled] Cron completed in', duration, 'ms')
            console.log('[Scheduled] Response:', body)
          })
          .catch((error: unknown) => {
            const duration = Date.now() - startTime
            console.error('[Scheduled] Cron failed after', duration, 'ms:', error)
          })
      )
    } catch (error) {
      const duration = Date.now() - startTime
      console.error('[Scheduled] Fatal error after', duration, 'ms:', error)
    }
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
}
