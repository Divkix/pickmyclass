import handler from 'vinext/server/app-router-entry';
import { processSection, retryDelaySeconds } from './lib/queue/process-section';
import type { Env } from './lib/types/env';
import type { ClassCheckMessage } from './lib/types/queue';
import { MaintenanceWorkflow, SectionCheckWorkflow } from './lib/workflows/cron-workflows';
import { withJsonApiError } from './lib/worker/api-errors';
import { edgeHtmlCache } from './lib/worker/edge-html-cache';
import {
  appendLinkEntry,
  appendVary,
  isHtmlResponse,
  markdownResponse,
  markdownSourcePath,
  pageLinkHeader,
  prefersMarkdown,
} from './lib/worker/markdown-negotiation';
import { getDb } from './lib/db';
import { log } from './lib/log';

const workerLog = log('Worker');
const queueLog = log('Queue');

/**
 * Advertises the Markdown representation on HTML responses so shared caches
 * keep the two variants apart, and points agents at the sitemap and the
 * Markdown twin before they parse the page. Copies the response because
 * headers off the assets binding are immutable.
 */
function withAgentHeaders(response: Response, pathname: string): Response {
  if (!isHtmlResponse(response)) return response;

  const varied = new Response(response.body, response);
  appendVary(varied.headers, 'Accept');
  appendLinkEntry(varied.headers, pageLinkHeader(pathname));
  return varied;
}

/**
 * Workflow classes are referenced only by `wrangler.jsonc` bindings (their
 * `schedules` replace a `scheduled()` handler), so they must stay exported
 * from the Worker entry module.
 */
export { MaintenanceWorkflow, SectionCheckWorkflow };

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

    const url = new URL(request.url);

    // A `.md` URL is a request for the Markdown twin of the page it names.
    // Static assets win: /pricing.md is a real file, not a twin of /pricing.
    const markdownPath = markdownSourcePath(url.pathname);
    if (markdownPath && isGetOrHead) {
      const asset = await env.ASSETS.fetch(request);
      if (asset.status !== 404) return asset;

      const target = new URL(request.url);
      target.pathname = markdownPath;
      const response = await handler.fetch(new Request(target, request), env, ctx);
      if (!isHtmlResponse(response)) return response;

      return markdownResponse({ response, html: await response.text(), url: request.url });
    }

    if (prefersMarkdown(request.headers.get('accept'))) {
      // Markdown requests never touch the edge cache: it stores one HTML
      // representation per path, and the conversion is cheap for agent traffic.
      const response = await handler.fetch(request, env, ctx);
      if (!isHtmlResponse(response)) return response;

      return markdownResponse({ response, html: await response.text(), url: request.url });
    }

    if (!edgeHtmlCache.isEligible(request)) {
      return withAgentHeaders(
        withJsonApiError(await handler.fetch(request, env, ctx), url.pathname, request.method),
        url.pathname
      );
    }

    const versionId = env.CF_VERSION_METADATA?.id;
    const cached = await edgeHtmlCache.get(request, versionId);
    if (cached) {
      return cached;
    }

    const response = withAgentHeaders(
      withJsonApiError(await handler.fetch(request, env, ctx), url.pathname, request.method),
      url.pathname
    );

    const cacheWrite = edgeHtmlCache.put(request, versionId, response);
    if (cacheWrite) ctx.waitUntil(cacheWrite);

    return response;
  },

  async queue(
    batch: MessageBatch<ClassCheckMessage>,
    env: Env,
    _ctx: ExecutionContext
  ): Promise<void> {
    const startTime = Date.now();
    queueLog.info(
      `Processing batch of ${batch.messages.length} messages from queue: ${batch.queue}`
    );

    const db = getDb(env.HYPERDRIVE);

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
          const delaySeconds = retryDelaySeconds(outcome, message.attempts);
          message.retry(delaySeconds === undefined ? undefined : { delaySeconds });
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
} satisfies ExportedHandler<Env, ClassCheckMessage>;
