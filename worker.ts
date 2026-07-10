/**
 * Custom Cloudflare Worker
 *
 * This wraps the vinext app-router-entry handler and adds scheduled (cron)
 * and queue consumer handlers for class seat checking.
 */

import { DurableObject } from 'cloudflare:workers';
import handler from 'vinext/server/app-router-entry';
import { hasSupabaseAuthCookiesInHeader } from './lib/auth/supabase-auth-cookies';
import { EDGE_HTML_CACHE_TTL_S } from './lib/config';
import { classifyDisposition } from './lib/queue/disposition';
import { handleDLQMessage } from './lib/queue/dlq-consumer';
import { processSection } from './lib/queue/process-section';
import type { Env } from './lib/types/env';
import type { ClassCheckMessage, QueueMessageBatch } from './lib/types/queue';

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
  private locked: boolean;
  private lockAcquiredAt: number | null;
  private lockHolder: string | null;
  private readonly LOCK_TIMEOUT_MS = 25 * 60 * 1000; // 25 minutes (safety before 30min cron)

  /**
   * Constructor - loads persistent state from storage
   */
  constructor(ctx: DurableObjectState, env: Cloudflare.Env) {
    super(ctx, env);

    // Initialize default state
    this.locked = false;
    this.lockAcquiredAt = null;
    this.lockHolder = null;

    // Load state from storage asynchronously
    this.ctx.blockConcurrencyWhile(async () => {
      const stored = await this.ctx.storage.get<{
        locked: boolean;
        lockAcquiredAt: number | null;
        lockHolder: string | null;
      }>('lock_state');

      if (stored) {
        // Check if lock expired during downtime
        if (
          stored.locked &&
          stored.lockAcquiredAt &&
          Date.now() - stored.lockAcquiredAt > this.LOCK_TIMEOUT_MS
        ) {
          console.log(
            '[CronLockDO] Lock expired during downtime, releasing (held by:',
            stored.lockHolder,
            ')'
          );
          this.locked = false;
          this.lockAcquiredAt = null;
          this.lockHolder = null;
          await this.persist();
        } else {
          this.locked = stored.locked;
          this.lockAcquiredAt = stored.lockAcquiredAt;
          this.lockHolder = stored.lockHolder;
          console.log('[CronLockDO] Loaded state from storage:', {
            locked: this.locked,
            holder: this.lockHolder,
          });
        }
      } else {
        console.log('[CronLockDO] Initialized with default state (unlocked)');
      }
    });
  }

  /**
   * Persist current state to durable storage
   */
  private async persist(): Promise<void> {
    await this.ctx.storage.put('lock_state', {
      locked: this.locked,
      lockAcquiredAt: this.lockAcquiredAt,
      lockHolder: this.lockHolder,
    });
  }

  /**
   * Attempt to acquire the cron lock
   *
   * @param holder - Identifier for who is acquiring the lock (for debugging)
   * @returns Object with acquired status and message
   */
  async acquireLock(holder: string = 'unknown'): Promise<{
    acquired: boolean;
    message: string;
    lockHolder?: string;
    lockedSince?: number;
  }> {
    // Check if lock expired
    if (
      this.locked &&
      this.lockAcquiredAt &&
      Date.now() - this.lockAcquiredAt >= this.LOCK_TIMEOUT_MS
    ) {
      console.log(
        `[CronLockDO] Lock expired (held by ${this.lockHolder} for ${Math.floor((Date.now() - this.lockAcquiredAt) / 1000)}s), auto-releasing`
      );
      this.locked = false;
      this.lockAcquiredAt = null;
      this.lockHolder = null;
      await this.persist();
    }

    // Check if already locked
    if (this.locked) {
      const timeHeld = this.lockAcquiredAt ? Date.now() - this.lockAcquiredAt : 0;
      const timeRemaining = this.LOCK_TIMEOUT_MS - timeHeld;

      console.log(
        `[CronLockDO] Lock acquisition denied - already held by ${this.lockHolder} for ${Math.floor(timeHeld / 1000)}s`
      );

      return {
        acquired: false,
        message: `Cron lock already held by ${this.lockHolder}. Time remaining: ${Math.ceil(timeRemaining / 1000)}s`,
        lockHolder: this.lockHolder || undefined,
        lockedSince: this.lockAcquiredAt || undefined,
      };
    }

    // Acquire lock
    this.locked = true;
    this.lockAcquiredAt = Date.now();
    this.lockHolder = holder;
    await this.persist();

    console.log(`[CronLockDO] Lock acquired by ${holder}`);

    return {
      acquired: true,
      message: `Lock acquired successfully`,
      lockHolder: holder,
      lockedSince: this.lockAcquiredAt,
    };
  }

  /**
   * Release the cron lock
   *
   * @param holder - Identifier for who is releasing (must match acquirer)
   */
  async releaseLock(holder: string = 'unknown'): Promise<{
    released: boolean;
    message: string;
  }> {
    if (!this.locked) {
      console.log(`[CronLockDO] Release requested by ${holder}, but lock not held`);
      return {
        released: false,
        message: 'Lock was not held',
      };
    }

    if (this.lockHolder !== holder) {
      console.warn(
        `[CronLockDO] Release denied - lock held by ${this.lockHolder}, requested by ${holder}`
      );
      return {
        released: false,
        message: `Lock held by different holder (${this.lockHolder})`,
      };
    }

    const timeHeld = this.lockAcquiredAt ? Date.now() - this.lockAcquiredAt : 0;

    this.locked = false;
    this.lockAcquiredAt = null;
    this.lockHolder = null;
    await this.persist();

    console.log(`[CronLockDO] Lock released by ${holder} after ${Math.floor(timeHeld / 1000)}s`);

    return {
      released: true,
      message: `Lock released after ${Math.floor(timeHeld / 1000)}s`,
    };
  }

  /**
   * Get current lock status
   */
  async getStatus(): Promise<{
    locked: boolean;
    lockHolder: string | null;
    lockAcquiredAt: number | null;
    timeHeldMs: number | null;
    expiresAt: number | null;
  }> {
    // Check for expiry
    if (
      this.locked &&
      this.lockAcquiredAt &&
      Date.now() - this.lockAcquiredAt >= this.LOCK_TIMEOUT_MS
    ) {
      this.locked = false;
      this.lockAcquiredAt = null;
      this.lockHolder = null;
      await this.persist();
    }

    const timeHeldMs = this.lockAcquiredAt ? Date.now() - this.lockAcquiredAt : null;
    const expiresAt = this.lockAcquiredAt ? this.lockAcquiredAt + this.LOCK_TIMEOUT_MS : null;

    return {
      locked: this.locked,
      lockHolder: this.lockHolder,
      lockAcquiredAt: this.lockAcquiredAt,
      timeHeldMs,
      expiresAt,
    };
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
 * Anonymous, fully-static marketing pages that are safe to serve from the
 * edge HTML cache. The HTML is identical for every visitor (auth resolves
 * client-side), so caching skips a full RSC render on every hit.
 *
 * Exact paths are matched verbatim; prefixes match nested pages (e.g.
 * /blog/<slug>, /legal/privacy).
 */
const EDGE_CACHE_EXACT_PATHS = new Set(['/', '/faq', '/about', '/blog', '/legal']);
const EDGE_CACHE_PREFIXES = ['/blog/', '/legal/'];

function isEdgeCacheablePath(pathname: string): boolean {
  return (
    EDGE_CACHE_EXACT_PATHS.has(pathname) ||
    EDGE_CACHE_PREFIXES.some((prefix) => pathname.startsWith(prefix))
  );
}

/**
 * Build a synthetic cache key for an anonymous marketing page.
 *
 * - Keyed on pathname only (query string ignored) so `?utm=…`/`?x=N` variants
 *   can't flood the cache or lower the hit rate.
 * - Includes the deploy version id so every deploy busts the cache — cached
 *   HTML references hashed /_next/static chunks that change per deploy.
 */
function edgeCacheKey(pathname: string, env: Env): Request {
  const versionId = env.CF_VERSION_METADATA?.id ?? 'dev';
  return new Request(`https://edge-cache.internal/${versionId}${pathname}`);
}

/**
 * Minimal shape of the Cloudflare default cache. The `caches` global is typed
 * by @types/node (whose CacheStorage lacks `.default`), so we narrow it here.
 */
interface EdgeCache {
  match(key: Request): Promise<Response | undefined>;
  put(key: Request, response: Response): Promise<void>;
}

/**
 * Export the worker with fetch, scheduled, queue handlers, and Durable Object classes
 */
export default {
  /**
   * HTTP request handler - routes to vinext app, with an edge HTML cache for
   * anonymous marketing pages (see isEdgeCacheablePath). On a cache hit we
   * return the stored response and skip proxy.ts + the RSC render entirely.
   */
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // Sanitize GET/HEAD requests with bodies - bots sometimes send these
    // Web API spec forbids Request objects with GET/HEAD + body
    const isGetOrHead = request.method === 'GET' || request.method === 'HEAD';
    const hasBody = request.body !== null;

    if (isGetOrHead && hasBody) {
      console.log(
        `[Worker] Sanitizing ${request.method} request with body from ${request.headers.get('cf-connecting-ip') || 'unknown'} to ${request.url}`
      );
      request = new Request(request, { body: null });
    }

    // Edge HTML cache: GET, allowlisted path, and no Supabase auth cookie
    // (logged-in users always get a fresh render so personalized headers /
    // redirects are never served from cache).
    //
    // RSC navigation/prefetch requests are excluded: Next.js issues them with
    // an `RSC: 1` header (and a `?_rsc=` query param) and expects a
    // `text/x-component` flight payload. Because the cache key ignores the
    // query string and does not vary on the RSC header, caching them would
    // let a flight response be served as a full document (the browser then
    // renders the raw RSC stream as text). See ADR 0009.
    const url = new URL(request.url);
    const pathname = url.pathname;
    const isRscRequest = request.headers.has('rsc') || url.searchParams.has('_rsc');
    const cacheEligible =
      request.method === 'GET' &&
      !isRscRequest &&
      isEdgeCacheablePath(pathname) &&
      !hasSupabaseAuthCookiesInHeader(request.headers.get('cookie'));

    if (!cacheEligible) {
      return handler.fetch(request);
    }

    const cache = (caches as unknown as { default: EdgeCache }).default;
    const cacheKey = edgeCacheKey(pathname, env);

    const cached = await cache.match(cacheKey);
    if (cached) {
      return cached;
    }

    const response = await handler.fetch(request);

    // Only cache successful, non-personalized HTML documents. The content-type
    // guard is defense in depth against caching a flight payload as a document
    // (see the RSC exclusion above and ADR 0009).
    const isHtml = response.headers.get('content-type')?.includes('text/html') ?? false;
    if (response.status === 200 && isHtml && !response.headers.has('set-cookie')) {
      const toStore = new Response(response.clone().body, response);
      toStore.headers.set('Cache-Control', `public, s-maxage=${EDGE_HTML_CACHE_TTL_S}`);
      ctx.waitUntil(cache.put(cacheKey, toStore));
    }

    return response;
  },

  /**
   * Scheduled handler - triggered by Cloudflare Cron
   *
   * Configured in wrangler.jsonc:
   * "triggers": { "crons": ["0,30 * * * *", "0 4 * * *"] }
   * - Every 30 minutes: class check cron
   * - Daily at 4 AM UTC: disposable domain list update
   */
  async scheduled(event: ScheduledEvent, env: Env, _ctx: ExecutionContext): Promise<void> {
    const startTime = Date.now();
    console.log('[Scheduled] Cron triggered at:', new Date(event.scheduledTime).toISOString());
    console.log('[Scheduled] Cron pattern:', event.cron);

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

      console.log('[Scheduled] Cron completed in', duration, 'ms');
      console.log('[Scheduled] Response:', body);

      if (!response.ok || response.status === 207) {
        // Surface partial or full enqueue failures with a greppable tag so they appear
        // in `wrangler tail` logs. Cloudflare cron has no auto-retry, so the goal is
        // visibility rather than recovery — we log rather than throw to avoid marking
        // the entire cron invocation as failed for partial batch failures.
        console.error('[Scheduled] CRON_PARTIAL_FAILURE status:', response.status, 'body:', body);
      }
    } catch (error) {
      const duration = Date.now() - startTime;
      console.error('[Scheduled] Fatal error after', duration, 'ms:', error);
    }
  },

  /**
   * Queue consumer handler - processes class section check messages
   *
   * Receives batches of up to 5 messages (configured in wrangler.jsonc)
   * Each message represents a single section to check for changes.
   */
  async queue(
    batch: QueueMessageBatch<ClassCheckMessage>,
    env: Env,
    _ctx: ExecutionContext
  ): Promise<void> {
    const startTime = Date.now();
    const isDLQ = batch.queue === 'pickmyclass-dlq';
    console.log(
      `[Queue] Processing batch of ${batch.messages.length} messages from queue: ${batch.queue}`
    );

    // Route DLQ messages to dedicated handler — always ack, never retry
    if (isDLQ) {
      for (const message of batch.messages) {
        try {
          await handleDLQMessage(message.body, env.EMAIL, {
            fromEmail: env.NOTIFICATION_FROM_EMAIL,
          });
        } catch (error) {
          console.error(
            `[Queue/DLQ] Unexpected error processing ${message.body.class_nbr}:`,
            error
          );
        }
        message.ack();
      }
      console.log(
        `[Queue/DLQ] Processed ${batch.messages.length} DLQ messages in ${Date.now() - startTime}ms`
      );
      return;
    }

    // Process all messages in the batch concurrently — direct call, no HTTP indirection.
    // classifyDisposition owns the ack/retry decision; this handler only translates
    // the verdict to the queue transport (ack → message.ack(), retry → message.retry()).
    const results = await Promise.allSettled(
      batch.messages.map(async (message) => {
        const msgStartTime = Date.now();
        try {
          const result = await processSection(message.body, env);
          const duration = Date.now() - msgStartTime;
          const disposition = classifyDisposition(result);

          if (disposition === 'ack') {
            console.log(`[Queue] Processed ${message.body.class_nbr} in ${duration}ms:`, result);
            message.ack();
            return { success: true, class_nbr: message.body.class_nbr, duration };
          }

          // DB upsert error — transient, retry
          console.error(
            `[Queue] DB failure for ${message.body.class_nbr} in ${duration}ms:`,
            result.error
          );
          message.retry();
          return { success: false, class_nbr: message.body.class_nbr, duration };
        } catch (error) {
          const duration = Date.now() - msgStartTime;
          const disposition = classifyDisposition(error);

          if (disposition === 'ack') {
            // Non-retryable: ASU auth failure or section no longer exists
            console.error(
              `[Queue] Non-retryable error for ${message.body.class_nbr} in ${duration}ms:`,
              error
            );
            message.ack();
            return { success: false, class_nbr: message.body.class_nbr, duration, acked: true };
          }

          // Retryable: upstream transient (rate limit / API error) or unknown — retry
          console.error(
            `[Queue] Retryable error for ${message.body.class_nbr} in ${duration}ms:`,
            error
          );
          message.retry();
          return { success: false, class_nbr: message.body.class_nbr, duration, error };
        }
      })
    );

    // Log batch summary
    const successful = results.filter((r) => r.status === 'fulfilled' && r.value.success).length;
    const failed = results.length - successful;
    const totalDuration = Date.now() - startTime;

    console.log(
      `[Queue] Batch complete in ${totalDuration}ms: ${successful} successful, ${failed} failed`
    );
  },

  /**
   * Durable Object classes exported for Cloudflare Workers
   * Must be included in the default export AND exported as named exports (see class definitions above)
   */
  CronLockDO,
} satisfies ExportedHandler<Env>;

/**
 * Cloudflare Workers cron event type
 */
interface ScheduledEvent {
  /** Unix timestamp (milliseconds) when the cron was scheduled to run */
  scheduledTime: number;
  /** The cron pattern that triggered this event (e.g., "0 * * * *") */
  cron: string;
}

/**
 * Cloudflare Workers exported handler type
 */
interface ExportedHandler<Env = unknown> {
  fetch?: (request: Request, env: Env, ctx: ExecutionContext) => Response | Promise<Response>;
  scheduled?: (event: ScheduledEvent, env: Env, ctx: ExecutionContext) => void | Promise<void>;
  queue?: (batch: QueueMessageBatch, env: Env, ctx: ExecutionContext) => void | Promise<void>;
  CronLockDO?: typeof CronLockDO;
}
