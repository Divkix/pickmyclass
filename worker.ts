/**
 * Custom Cloudflare Worker
 *
 * This wraps the vinext app-router-entry handler and adds scheduled (cron)
 * and queue consumer handlers for class seat checking.
 */

import { DurableObject } from 'cloudflare:workers';
import handler from 'vinext/server/app-router-entry';
import { handleDLQMessage } from './lib/queue/dlq-consumer';
import { processSection } from './lib/queue/process-section';
import type { Env } from './lib/types/env';
import type { ClassCheckMessage } from './lib/types/queue';
import { createCronLockLifecycle } from './lib/worker/cron-lock';
import { edgeHtmlCache } from './lib/worker/edge-html-cache';
import { setConnectionStringGetter } from './lib/db/client';
import { log } from './lib/log';

/**
 * Register the Hyperdrive connection string getter with the given env.
 * Called at the start of each handler (fetch/scheduled/queue) so the env
 * parameter — which is guaranteed to be populated — is used instead of
 * the module-level `cloudflare:workers` env import.
 * Idempotent: re-registering just replaces the getter.
 */
function registerHyperdrive(env: Env): void {
  setConnectionStringGetter(() => {
    return env.HYPERDRIVE?.connectionString ?? '';
  });
}

const workerLog = log('Worker');
const scheduledLog = log('Scheduled');
const queueLog = log('Queue');
const dlqLog = log('Queue/DLQ');

/**
 * Durable Object for distributed cron job locking
 *
 * Ensures only one cron job can run at a time across all Worker isolates.
 * Prevents resource waste from concurrent cron triggers enqueuing duplicate
 * section check messages.
 *
 * **Architecture:**
 * - Single instance per cron job (identified by name "pickmyclass-cron-lock")
 * - Persistent state via Durable Object storage
 * - Auto-expires after 25 minutes (safety margin before next cron)
 * - Handles Worker crashes via timeout mechanism
 *
 * **Usage:**
 * ```typescript
 * const lock = await cronLock.acquireLock()
 * if (!lock.acquired) {
 *   return Response.json({ error: 'Cron already running' }, { status: 409 })
 * }
 * try {
 *   // ... cron processing
 * } finally {
 *   await cronLock.releaseLock()
 * }
 * ```
 */
export class CronLockDO extends DurableObject<Cloudflare.Env> {
  private readonly lock;

  /**
   * Constructor - loads persistent state from storage
   */
  constructor(ctx: DurableObjectState, env: Cloudflare.Env) {
    super(ctx, env);
    this.lock = createCronLockLifecycle({
      load: () => this.ctx.storage.get('lock_state'),
      save: (state) => this.ctx.storage.put('lock_state', state),
    });
    this.ctx.blockConcurrencyWhile(() => this.lock.initialize());
  }

  /**
   * Attempt to acquire the cron lock
   *
   * @param holder - Identifier for who is acquiring the lock (for debugging)
   * @returns Object with acquired status and message
   */
  async acquireLock(holder: string = 'unknown') {
    return this.lock.acquire(holder);
  }

  /**
   * Release the cron lock
   *
   * @param holder - Identifier for who is releasing (must match acquirer)
   */
  async releaseLock(holder: string = 'unknown') {
    return this.lock.release(holder);
  }

  /**
   * Get current lock status
   */
  async getStatus() {
    return this.lock.status();
  }

  /**
   * Fetch handler - provides HTTP API for lock operations
   */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const holder = url.searchParams.get('holder') || 'http-request';

    switch (url.pathname) {
      case '/acquire':
        if (request.method !== 'POST') {
          return new Response('Method not allowed', { status: 405 });
        }
        return Response.json(await this.acquireLock(holder));

      case '/release':
        if (request.method !== 'POST') {
          return new Response('Method not allowed', { status: 405 });
        }
        return Response.json(await this.releaseLock(holder));

      case '/status':
        return Response.json(await this.getStatus());

      default:
        return new Response('Not found', { status: 404 });
    }
  }
}

/**
 * Force Durable Object exports to prevent tree-shaking
 *
 * esbuild removes exports that aren't directly used in the code path.
 * These classes are only referenced via wrangler.jsonc bindings, not in code,
 * so we create a runtime reference to keep them in the bundle.
 */
export const __durableObjectExports = {
  CronLockDO,
} as const;

// Runtime registration (executes on worker init)
if (typeof __durableObjectExports === 'undefined') {
  throw new Error('Durable Object exports missing');
}

/**
 * Export the worker with fetch, scheduled, queue handlers, and Durable Object classes
 */
export default {
  /**
   * HTTP request handler - routes to vinext app, with an edge HTML cache for
   * anonymous marketing pages (see edgeHtmlCache). On a cache hit we
   * return the stored response and skip proxy.ts + the RSC render entirely.
   */
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    registerHyperdrive(env);

    // Sanitize GET/HEAD requests with bodies - bots sometimes send these
    // Web API spec forbids Request objects with GET/HEAD + body
    const isGetOrHead = request.method === 'GET' || request.method === 'HEAD';
    const hasBody = request.body !== null;

    if (isGetOrHead && hasBody) {
      workerLog.info(
        `Sanitizing ${request.method} request with body from ${request.headers.get('cf-connecting-ip') || 'unknown'} to ${request.url}`
      );
      request = new Request(request, { body: null });
    }

    if (!edgeHtmlCache.isEligible(request)) {
      return handler.fetch(request);
    }

    const versionId = env.CF_VERSION_METADATA?.id;
    const cached = await edgeHtmlCache.get(request, versionId);
    if (cached) {
      return cached;
    }

    const response = await handler.fetch(request);

    const cacheWrite = edgeHtmlCache.put(request, versionId, response);
    if (cacheWrite) ctx.waitUntil(cacheWrite);

    return response;
  },

  /**
   * Scheduled handler - triggered by Cloudflare Cron
   *
   * Configured in wrangler.jsonc:
   * "triggers": { "crons": ["0,30 * * * *", "0 4 * * *"] }
   * - Every 30 minutes: class check cron
   * - Daily at 4 AM UTC: daily maintenance sweeps
   */
  async scheduled(
    event: Pick<ScheduledController, 'cron' | 'scheduledTime'>,
    env: Env,
    _ctx: ExecutionContext
  ): Promise<void> {
    registerHyperdrive(env);

    const startTime = Date.now();
    scheduledLog.info('Cron triggered at:', new Date(event.scheduledTime).toISOString());
    scheduledLog.info('Cron pattern:', event.cron);

    const cronRoute =
      event.cron === '0 4 * * *' ? '/api/cron/update-disposable-domains' : '/api/cron';

    try {
      // Make internal HTTP request to the API route
      // This allows us to reuse the same logic whether triggered by cron or manually
      // Pass scheduled time as header so API route computes correct stagger group
      // even if cron execution is delayed
      const request = new Request(`http://localhost${cronRoute}`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${env.CRON_SECRET}`,
          'User-Agent': 'Cloudflare-Workers-Cron',
          'X-Cron-Scheduled-Time': String(event.scheduledTime),
        },
      });

      // Execute the cron job and await completion
      // Environment bindings are accessed in API routes via import { env } from 'cloudflare:workers'
      const response = await handler.fetch(request);
      const body = await response.text();
      const duration = Date.now() - startTime;

      scheduledLog.info('Cron completed in', duration, 'ms');
      scheduledLog.info('Response:', body);

      if (!response.ok || response.status === 207) {
        // Surface partial or full enqueue failures with a greppable tag so they appear
        // in `wrangler tail` logs. Cloudflare cron has no auto-retry, so the goal is
        // visibility rather than recovery — we log rather than throw to avoid marking
        // the entire cron invocation as failed for partial batch failures.
        scheduledLog.error('CRON_PARTIAL_FAILURE status:', response.status, 'body:', body);
      }
    } catch (error) {
      const duration = Date.now() - startTime;
      scheduledLog.error('Fatal error after', duration, 'ms:', error);
    }
  },

  /**
   * Queue consumer handler - processes class section check messages
   *
   * Receives batches of up to 5 messages (configured in wrangler.jsonc)
   * Each message represents a single section to check for changes.
   */
  async queue(
    batch: MessageBatch<ClassCheckMessage>,
    env: Env,
    _ctx: ExecutionContext
  ): Promise<void> {
    registerHyperdrive(env);

    const startTime = Date.now();
    const isDLQ = batch.queue === 'pickmyclass-dlq';
    queueLog.info(
      `Processing batch of ${batch.messages.length} messages from queue: ${batch.queue}`
    );

    // Route DLQ messages to dedicated handler — always ack, never retry
    if (isDLQ) {
      for (const message of batch.messages) {
        try {
          await handleDLQMessage(message.body, env.EMAIL, {
            fromEmail: env.NOTIFICATION_FROM_EMAIL,
          });
        } catch (error) {
          dlqLog.error(`Unexpected error processing ${message.body.class_nbr}:`, error);
        }
        message.ack();
      }
      dlqLog.info(`Processed ${batch.messages.length} DLQ messages in ${Date.now() - startTime}ms`);
      return;
    }

    // Process all messages in the batch concurrently — direct call, no HTTP indirection.
    // processSection owns the ack/retry decision; this handler only translates
    // outcome.disposition to the queue transport (ack → message.ack(), retry → message.retry()).
    const results = await Promise.allSettled(
      batch.messages.map(async (message) => {
        const msgStartTime = Date.now();
        try {
          const outcome = await processSection(message.body, env);
          const duration = Date.now() - msgStartTime;

          if (outcome.disposition === 'ack') {
            if (!outcome.result.success) {
              queueLog.error(
                `Non-retryable error for ${message.body.class_nbr} in ${duration}ms:`,
                outcome.result.error
              );
            } else {
              queueLog.info(
                `Processed ${message.body.class_nbr} in ${duration}ms:`,
                outcome.result
              );
            }
            message.ack();
            return {
              success: outcome.result.success,
              class_nbr: message.body.class_nbr,
              duration,
            };
          }

          queueLog.error(
            `Failed to process ${message.body.class_nbr} in ${duration}ms:`,
            outcome.result.error
          );
          message.retry();
          return { success: false, class_nbr: message.body.class_nbr, duration };
        } catch (error) {
          const duration = Date.now() - msgStartTime;
          // Defensive: processSection should not throw ApiError, but if it does bubble
          // an unexpected error, retry.
          queueLog.error(`Retryable error for ${message.body.class_nbr} in ${duration}ms:`, error);
          message.retry();
          return { success: false, class_nbr: message.body.class_nbr, duration, error };
        }
      })
    );

    // Log batch summary
    const successful = results.filter((r) => r.status === 'fulfilled' && r.value.success).length;
    const failed = results.length - successful;
    const totalDuration = Date.now() - startTime;

    queueLog.info(
      `Batch complete in ${totalDuration}ms: ${successful} successful, ${failed} failed`
    );
  },

  /**
   * Durable Object classes exported for Cloudflare Workers
   * Must be included in the default export AND exported as named exports (see class definitions above)
   */
  CronLockDO,
} satisfies ExportedHandler<Env, ClassCheckMessage> & { CronLockDO: typeof CronLockDO };
