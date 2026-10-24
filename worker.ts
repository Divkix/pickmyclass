import handler from "vinext/server/app-router-entry";
import {
  type SectionCheckOutcome,
  processSection,
  retryDelaySeconds,
} from "./lib/queue/process-section";
import type { Env } from "./lib/types/env";
import type { ClassCheckMessage } from "./lib/types/queue";
import {
  MaintenanceWorkflow,
  SectionCheckWorkflow,
  cycleElapsedMs,
} from "./lib/workflows/cron-workflows";
import { withJsonApiError } from "./lib/worker/api-errors";
import { fetchAsset } from "./lib/worker/calls";
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
import { classCheckMessageSchema } from "./lib/queue/message-schema";
import { QUEUE_MAX_RETRIES } from "./lib/config";
import { errorFields, errorName, log, logEvent, tagLogs } from "./lib/log";
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
    const versionId = env.CF_VERSION_METADATA?.id;
    tagLogs(versionId);
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
      const asset = await fetchAsset(env.ASSETS, request);

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
    tagLogs(env.CF_VERSION_METADATA?.id);
    const startTime = Date.now();
    queueLog.info("Processing batch", { queue: batch.queue, messages: batch.messages.length });

    const db = getDb(env.HYPERDRIVE);

    const results = await Promise.allSettled(
      batch.messages.map((delivery) => {
        const parsed = classCheckMessageSchema.safeParse(delivery.body);

        if (!parsed.success) {
          // Retried until max_retries so the body lands in the DLQ, where it can be inspected.
          queueLog.error("Invalid queue message, retrying toward the dead-letter queue", {
            message_id: delivery.id,
            attempts: delivery.attempts,
            "error.message": parsed.error.issues
              .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
              .join("; "),
          });
          delivery.retry();

          return Promise.resolve({ success: false });
        }

        // The runtime's own message object: spreading it would drop ack() and retry().
        const message = delivery;
        const body = parsed.data;

        const fields = {
          message_id: message.id,
          attempts: message.attempts,
          ...sectionFields(body),
          cycle: body.cycle,
          workflow_instance_id: body.workflow_instance_id,
        };

        // Workers tracing exposes no trace ids yet, so `cycle` and
        // `workflow_instance_id` link this span back to the enqueueing run.
        return withSpan("section_check", fields, async (span) => {
          const msgStartTime = Date.now();

          const complete = (
            result: "ok" | "failed" | "threw",
            disposition: SectionCheckOutcome["disposition"],
            processed?: SectionCheckOutcome["result"],
          ) => {
            span.setAttribute("section_check.disposition", disposition);
            logEvent("section_check_completed", {
              ...sectionFields(body),
              cycle: body.cycle,
              workflow_instance_id: body.workflow_instance_id,
              result,
              disposition,
              attempts: message.attempts,
              duration_ms: Date.now() - msgStartTime,
              cycle_elapsed_ms: cycleElapsedMs(body.cycle, Date.now()),
              emails_sent: processed?.emailsSent ?? 0,
              seat_opened: processed?.changes.seatBecameAvailable ?? false,
              instructor_assigned: processed?.changes.instructorAssigned ?? false,
              dead_lettered: disposition === "retry" && message.attempts > QUEUE_MAX_RETRIES,
            });

            return { success: result === "ok" };
          };

          try {
            const outcome = await processSection(db, body, env);
            const duration_ms = Date.now() - msgStartTime;

            if (outcome.disposition === "ack") {
              if (!outcome.result.success)
                queueLog.error("Non-retryable Section Check failure, acking", {
                  ...fields,
                  duration_ms,
                  "error.message": outcome.result.error,
                });

              message.ack();

              return complete(outcome.result.success ? "ok" : "failed", "ack", outcome.result);
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

            return complete("failed", "retry", outcome.result);
          } catch (error) {
            // processSection decides ack/retry for its own failures; reaching here is a defect.
            span.setAttribute("error.type", errorName(error));
            queueLog.error("Section Check threw, retrying", {
              ...fields,
              ...errorFields(error),
              duration_ms: Date.now() - msgStartTime,
            });
            message.retry();

            return complete("threw", "retry");
          }
        });
      }),
    );

    const successful = results.filter((r) => r.status === "fulfilled" && r.value.success).length;

    logEvent("queue_batch_processed", {
      queue: batch.queue,
      messages: results.length,
      successful,
      failed: results.length - successful,
      duration_ms: Date.now() - startTime,
    });
  },
} satisfies ExportedHandler<Env, ClassCheckMessage>;
