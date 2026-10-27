/**
 * Custom spans for the work Workers tracing doesn't instrument itself:
 * Postgres over Hyperdrive, Queue sends, Email sends, ASU fetches and Section
 * Checks. Logs written inside a span are attributed to it by the runtime, so
 * they carry its trace and span ids in Uptrace.
 *
 * **Server-only module**: it imports `cloudflare:workers`.
 */
import { tracing } from "cloudflare:workers";
import { errorName, type LogValue } from "@/lib/log";

/** Like `LogFields` (opaque ids, counts, outcomes; never emails, names or SQL values), minus null. */
export type SpanAttributes = Readonly<Record<string, Exclude<LogValue, null>>>;

/**
 * Runs `run` inside a child span of whatever is active. A throw tags the span
 * with `error.type` and rethrows unchanged; the runtime has no span status yet.
 */
export function withSpan<T>(
  name: string,
  attributes: SpanAttributes,
  run: (span: Span) => Promise<T>,
): Promise<T> {
  return tracing.enterSpan(name, async (span) => {
    span.setAttributes(attributes);

    try {
      return await run(span);
    } catch (error) {
      span.setAttribute("error.type", errorName(error));
      throw error;
    }
  });
}
