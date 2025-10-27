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

import type { ClassCheckMessage, QueueMessageBatch } from './lib/types/queue'

/**
 * Cloudflare Workers environment bindings
 */
interface Env {
  ASSETS: Fetcher
  CRON_SECRET: string
  CLASS_CHECK_QUEUE: Queue<ClassCheckMessage>
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
