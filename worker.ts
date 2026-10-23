import handler from "vinext/server/app-router-entry";
import { processSection, retryDelaySeconds } from "./lib/queue/process-section";
import type { Env } from "./lib/types/env";
import type { ClassCheckMessage } from "./lib/types/queue";
import { MaintenanceWorkflow, SectionCheckWorkflow } from "./lib/workflows/cron-workflows";
import { withJsonApiError } from "./lib/worker/api-errors";
import { handleOtelIngest, isOtelIngestPath } from "./lib/worker/otel-ingest";
import { edgeHtmlCache } from "./lib/worker/edge-html-cache";
import {
  appendLinkEntry,
  appendVary,
  isHtmlResponse,
  markdownResponse,
  markdownSourcePath,
  pageLinkHeader,
  prefersMarkdown,
} from "./lib/worker/markdown-negotiation";
import { getDb } from "./lib/db";
import { errorFields, errorName, log } from "./lib/log";
import { sectionFields } from "./lib/section-ref";
import { withSpan } from "./lib/telemetry/span";

const workerLog = log("Worker");

const queueLog = log("Queue");

/**
 * Advertises the Markdown representation on HTML responses so shared caches
 * keep the two variants apart, and points agents at the sitemap and the
 * Markdown twin before they parse the page. Copies the response because
 * headers off the assets binding are immutable.
 */
function withAgentHeaders(response: Response, pathname: string): Response {
  if (!isHtmlResponse(response)) return response;

  const varied = new Response(response.body, response);
  appendVary(varied.headers, "Accept");
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
    const url = new URL(request.url);

    if (isOtelIngestPath(url.pathname)) return handleOtelIngest(request, env, ctx);

    // Sanitize GET/HEAD requests with bodies - bots sometimes send these
    // Web API spec forbids Request objects with GET/HEAD + body
    const isGetOrHead = request.method === "GET" || request.method === "HEAD";
    const hasBody = request.body !== null;

    if (isGetOrHead && hasBody) {
      workerLog.info("Sanitizing GET/HEAD request with body", {
        method: request.method,
        path: url.pathname,
      });
      request = new Request(request, { body: null });
    }

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

    if (prefersMarkdown(request.headers.get("accept"))) {
      // Markdown requests never touch the edge cache: it stores one HTML
      // representation per path, and the conversion is cheap for agent traffic.
      const response = await handler.fetch(request, env, ctx);

      if (!isHtmlResponse(response)) return response;

      return markdownResponse({ response, html: await response.text(), url: request.url });
    }

    if (!edgeHtmlCache.isEligible(request)) {
      return withAgentHeaders(
        withJsonApiError(await handler.fetch(request, env, ctx), url.pathname, request.method),
        url.pathname,
      );
    }

    const versionId = env.CF_VERSION_METADATA?.id;
    const cached = await edgeHtmlCache.get(request, versionId);

    if (cached) {
      return cached;
    }

    const response = withAgentHeaders(
      withJsonApiError(await handler.fetch(request, env, ctx), url.pathname, request.method),
      url.pathname,
    );

    const cacheWrite = edgeHtmlCache.put(request, versionId, response);

    if (cacheWrite) ctx.waitUntil(cacheWrite);

    return response;
  },

  async queue(
    batch: MessageBatch<ClassCheckMessage>,
    env: Env,
    _ctx: ExecutionContext,
  ): Promise<void> {
    const startTime = Date.now();
    queueLog.info("Processing batch", { queue: batch.queue, messages: batch.messages.length });

    const db = getDb(env.HYPERDRIVE);

    const results = await Promise.allSettled(
      batch.messages.map((message) => {
        const fields = {
          message_id: message.id,
          attempts: message.attempts,
          ...sectionFields(message.body),
          cycle: message.body.cycle,
          workflow_instance_id: message.body.workflow_instance_id,
        };

        // Workers tracing exposes no trace ids yet, so `cycle` and
        // `workflow_instance_id` link this span back to the enqueueing run.
        return withSpan("section_check", fields, async (span) => {
          const msgStartTime = Date.now();

          try {
            const outcome = await processSection(db, message.body, env);
            span.setAttribute("section_check.disposition", outcome.disposition);

            const duration_ms = Date.now() - msgStartTime;

            if (outcome.disposition === "ack") {
              if (!outcome.result.success) {
                queueLog.error("Non-retryable Section Check failure, acking", {
                  ...fields,
                  duration_ms,
                  "error.message": outcome.result.error,
                });
              } else {
                queueLog.info("Processed Section Check", {
                  ...fields,
                  duration_ms,
                  emails_sent: outcome.result.emailsSent,
                  seat_became_available: outcome.result.changes.seatBecameAvailable,
                  instructor_assigned: outcome.result.changes.instructorAssigned,
                });
              }

              message.ack();

              return { success: outcome.result.success };
            }

            const delaySeconds = retryDelaySeconds(outcome, message.attempts);
            queueLog.error("Section Check failed, retrying", {
              ...fields,
              duration_ms,
              http_status: outcome.httpStatus,
              retry_delay_s: delaySeconds,
              "error.message": outcome.result.error,
            });
            message.retry(delaySeconds === undefined ? undefined : { delaySeconds });

            return { success: false };
          } catch (error) {
            span.setAttributes({
              "section_check.disposition": "retry",
              "error.type": errorName(error),
            });
            queueLog.error("Section Check threw, retrying", {
              ...fields,
              ...errorFields(error),
              duration_ms: Date.now() - msgStartTime,
            });
            message.retry();

            return { success: false };
          }
        });
      }),
    );

    const successful = results.filter((r) => r.status === "fulfilled" && r.value.success).length;

    queueLog.info("Batch complete", {
      queue: batch.queue,
      duration_ms: Date.now() - startTime,
      successful,
      failed: results.length - successful,
    });
  },
} satisfies ExportedHandler<Env, ClassCheckMessage>;
