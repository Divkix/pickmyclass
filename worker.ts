import { DurableObject } from 'cloudflare:workers';
import handler from 'vinext/server/app-router-entry';
import { handleDLQMessage } from './lib/queue/dlq-consumer';
import { processSection } from './lib/queue/process-section';
import type { Env } from './lib/types/env';
import type { ClassCheckMessage } from './lib/types/queue';
import { createCronLockLifecycle } from './lib/worker/cron-lock';
import { edgeHtmlCache } from './lib/worker/edge-html-cache';
import { getDb } from './lib/db';
import { log } from './lib/log';

const workerLog = log('Worker');
const scheduledLog = log('Scheduled');
const queueLog = log('Queue');
const dlqLog = log('Queue/DLQ');

export class CronLockDO extends DurableObject<Cloudflare.Env> {
  private readonly lock;

  constructor(ctx: DurableObjectState, env: Cloudflare.Env) {
    super(ctx, env);
    this.lock = createCronLockLifecycle({
      load: () => this.ctx.storage.get('lock_state'),
      save: (state) => this.ctx.storage.put('lock_state', state),
    });
    this.ctx.blockConcurrencyWhile(() => this.lock.initialize());
  }

  async acquireLock(holder: string = 'unknown') {
    return this.lock.acquire(holder);
  }

  async releaseLock(holder: string = 'unknown') {
    return this.lock.release(holder);
  }

  async getStatus() {
    return this.lock.status();
  }

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

if (typeof __durableObjectExports === 'undefined') {
  throw new Error('Durable Object exports missing');
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
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

  async scheduled(
    event: Pick<ScheduledController, 'cron' | 'scheduledTime'>,
    env: Env,
    _ctx: ExecutionContext
  ): Promise<void> {
    const startTime = Date.now();
    scheduledLog.info('Cron triggered at:', new Date(event.scheduledTime).toISOString());
    scheduledLog.info('Cron pattern:', event.cron);

    const cronRoute = event.cron === '0 4 * * *' ? '/api/cron/maintenance' : '/api/cron';

    try {
      const request = new Request(`http://localhost${cronRoute}`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${env.CRON_SECRET}`,
          'User-Agent': 'Cloudflare-Workers-Cron',
          'X-Cron-Scheduled-Time': String(event.scheduledTime),
        },
      });

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

  async queue(
    batch: MessageBatch<ClassCheckMessage>,
    env: Env,
    _ctx: ExecutionContext
  ): Promise<void> {
    const db = getDb(env.HYPERDRIVE);

    const startTime = Date.now();
    const isDLQ = batch.queue === 'pickmyclass-dlq';
    queueLog.info(
      `Processing batch of ${batch.messages.length} messages from queue: ${batch.queue}`
    );

    if (isDLQ) {
      for (const message of batch.messages) {
        try {
          await handleDLQMessage(db, message.body, env.EMAIL, {
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

    const results = await Promise.allSettled(
      batch.messages.map(async (message) => {
        const msgStartTime = Date.now();
        try {
          const outcome = await processSection(db, message.body, env);
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
          queueLog.error(`Retryable error for ${message.body.class_nbr} in ${duration}ms:`, error);
          message.retry();
          return { success: false, class_nbr: message.body.class_nbr, duration, error };
        }
      })
    );

    const successful = results.filter((r) => r.status === 'fulfilled' && r.value.success).length;
    const failed = results.length - successful;
    const totalDuration = Date.now() - startTime;

    queueLog.info(
      `Batch complete in ${totalDuration}ms: ${successful} successful, ${failed} failed`
    );
  },

  CronLockDO,
} satisfies ExportedHandler<Env, ClassCheckMessage> & { CronLockDO: typeof CronLockDO };
