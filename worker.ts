/**
 * Custom Cloudflare Worker
 *
 * This wraps the vinext app-router-entry handler and adds scheduled (cron)
 * and queue consumer handlers for class seat checking.
 */

import { DurableObject } from 'cloudflare:workers';
import handler from 'vinext/server/app-router-entry';
import type { ClassCheckMessage, QueueMessageBatch } from './lib/types/queue';

/**
 * Cloudflare Workers environment bindings
 */
interface Env {
  ASSETS: Fetcher;
  CRON_SECRET: string;
  CLASS_CHECK_QUEUE: Queue<ClassCheckMessage>;
  CRON_LOCK_DO: DurableObjectNamespace;
  DISPOSABLE_DOMAINS_KV: KVNamespace;
  NEXT_PUBLIC_SUPABASE_URL: string;
  NEXT_PUBLIC_SUPABASE_ANON_KEY: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  ASU_API_BASE_URL: string;
  ASU_API_TOKEN: string;
  RESEND_API_KEY?: string;
  NOTIFICATION_FROM_EMAIL?: string;
}

/**
 * Cloudflare Workers Fetcher type (for asset serving)
 */
interface Fetcher {
  fetch(request: Request): Promise<Response>;
}

/**
 * Durable Object for distributed cron job locking
 *
 * Ensures only one cron job can run at a time across all Worker isolates.
 * Prevents resource waste from concurrent cron triggers enqueuing duplicate
 * section check messages.
 *
 * **Architecture:**
 * - Single instance per cron job (identified by name "class-check-cron-lock")
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
   * Force release lock (admin/testing only)
   */
  async forceRelease(): Promise<void> {
    console.log(`[CronLockDO] Force release requested`);
    this.locked = false;
    this.lockAcquiredAt = null;
    this.lockHolder = null;
    await this.persist();
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

      case '/force-release':
        if (request.method !== 'POST') {
          return new Response('Method not allowed', { status: 405 });
        }
        await this.forceRelease();
        return Response.json({ success: true, message: 'Lock force released' });

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
   * HTTP request handler - routes to vinext app
   */
  fetch: handler.fetch,

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
      const request = new Request(`http://localhost${cronRoute}`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${env.CRON_SECRET}`,
          'User-Agent': 'Cloudflare-Workers-Cron',
        },
      });

      // Execute the cron job and await completion
      // Environment bindings are accessed in API routes via import { env } from 'cloudflare:workers'
      const response = await handler.fetch(request);
      const body = await response.text();
      const duration = Date.now() - startTime;

      console.log('[Scheduled] Cron completed in', duration, 'ms');
      console.log('[Scheduled] Response:', body);

      if (!response.ok) {
        console.error('[Scheduled] Cron returned error status:', response.status);
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
    console.log(
      `[Queue] Processing batch of ${batch.messages.length} messages from queue: ${batch.queue}`
    );

    // Process all messages in the batch concurrently
    const results = await Promise.allSettled(
      batch.messages.map(async (message) => {
        const msgStartTime = Date.now();
        try {
          // Make internal HTTP request to the section processor API route
          const request = new Request('http://localhost/api/queue/process-section', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${env.CRON_SECRET}`,
              'Content-Type': 'application/json',
              'User-Agent': 'Cloudflare-Workers-Queue',
            },
            body: JSON.stringify(message.body),
          });

          const response = await handler.fetch(request);
          const result = await response.json();

          const duration = Date.now() - msgStartTime;

          if (response.ok) {
            console.log(`[Queue] Processed ${message.body.class_nbr} in ${duration}ms:`, result);
            message.ack(); // Acknowledge successful processing
          } else {
            console.error(`[Queue] Failed ${message.body.class_nbr} in ${duration}ms:`, result);
            message.retry(); // Retry on failure
          }

          return { success: response.ok, class_nbr: message.body.class_nbr, duration };
        } catch (error) {
          const duration = Date.now() - msgStartTime;
          console.error(
            `[Queue] Error processing ${message.body.class_nbr} in ${duration}ms:`,
            error
          );
          message.retry(); // Retry on error
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
