/**
 * Same-origin ingest for the browser telemetry SDK.
 *
 * The page posts OTLP to `/otel/v1/{traces,logs}`. The Worker acknowledges it
 * before forwarding in waitUntil with a bounded collector call; collector
 * outages never delay the browser. The ingestion key stays server-side, JSON
 * is scrubbed, and stale/skewed spans are dropped rather than re-timestamped.
 */
import { z } from "zod";
import {
  OTEL_BROWSER_MAX_SPAN_AGE_MS,
  OTEL_BROWSER_MAX_SPAN_FUTURE_MS,
  OTEL_COLLECTOR_ERROR_BODY_BYTES,
} from "@/lib/config";
import { errorFields, log, redactEmails } from "@/lib/log";
import type { Env } from "@/lib/types/env";
import { collectorCall } from "@/lib/worker/calls";
import { CollectorCallFailed, CollectorCallTimedOut } from "@/lib/worker/errors";

const OTEL_PATH = /^\/otel(\/|$)/;

const SIGNAL_PATH = /^\/otel\/v1\/(traces|logs)$/;

const SIGNALS = ["traces", "logs"] as const;

type OtelSignal = (typeof SIGNALS)[number];

function isSignal(value: string | undefined): value is OtelSignal {
  return SIGNALS.some((signal) => signal === value);
}

const MAX_BODY_BYTES = 1024 * 1024;

// A compressed JSON batch is inspected after inflating; the cap stops a small body from expanding
// into more than the Worker should hold.
const MAX_INFLATED_BYTES = 8 * MAX_BODY_BYTES;

const FORWARDED_HEADERS = ["content-type", "content-encoding"] as const;

// A query string or fragment can carry a token or an admin search term.
// Backslash stops the match so an escaped quote inside a JSON string survives.
const URL_QUERY = /(https?:\/\/[^\s"?#\\]*)[?#][^\s"\\]*/gi;

const UNCOMPRESSED = new Set([null, "identity"]);

const COUNTRY_KEY = "geo.country.iso_code";

// Cloudflare's codes for Tor exits (T1) and unknown origins (XX).
const NO_COUNTRY = new Set(["T1", "XX"]);

const edgeCountry = z.object({ country: z.string().optional() });

// HyperDX 0.26 encodes undefined resource values as {}, non-finite numbers as
// doubleValue:null, and oversized integers as intValue. OpenObserve v1.1.2
// rejects the entire batch for any of those, including nested AnyValues.
const otlpValue: z.ZodType = z.lazy(() =>
  z.union([
    z.object({ stringValue: z.string() }),
    z.object({ boolValue: z.boolean() }),
    z.object({ doubleValue: z.number() }),
    z.object({
      intValue: z
        .union([z.string().regex(/^-?\d{1,19}$/), z.number().refine(Number.isInteger)])
        .refine((value) => {
          const integer = BigInt(value);

          return BigInt.asIntN(64, integer) === integer;
        }),
    }),
    z.object({
      bytesValue: z.string().refine((value) => {
        try {
          return btoa(atob(value)) === value;
        } catch {
          return false;
        }
      }),
    }),
    z.object({
      arrayValue: z.object({ values: z.array(otlpValue).optional() }),
    }),
    z.object({
      kvlistValue: z.object({ values: z.array(otlpAttribute).optional() }),
    }),
  ]),
);

const otlpAttribute = z.looseObject({
  key: z.string(),
  value: otlpValue.nullable().optional(),
});

const otlpIds = z.looseObject({
  traceId: z.string().regex(/^[\da-f]{32}$/i).optional(),
  spanId: z.string().regex(/^[\da-f]{16}$/i).optional(),
});

// Validate only the fields we inspect, preserving every other OTLP field.
const otlpResourceBatch = z.looseObject({
  resource: z
    .looseObject({ attributes: z.array(z.looseObject({ key: z.string() })).optional() })
    .optional(),
});

const otlpSpan = otlpIds.extend({
  startTimeUnixNano: z.union([
    z.string().regex(/^\d{1,20}$/),
    // OTLP JSON also permits numeric uint64 values, beyond JS's safe-integer range.
    z.number().nonnegative().refine(Number.isInteger),
  ]),
});

const otlpTraceBatch = otlpResourceBatch.extend({
  scopeSpans: z
    .array(z.looseObject({ spans: z.array(z.unknown()).optional() }))
    .optional(),
});

const otlpPayload = z.looseObject({
  resourceSpans: z.array(otlpTraceBatch).optional(),
  resourceLogs: z.array(otlpResourceBatch).optional(),
});

const ingestLog = log("OtelIngest");

export function isOtelIngestPath(pathname: string): boolean {
  return OTEL_PATH.test(pathname);
}

/** The visitor's country from Cloudflare's edge, and nothing finer (privacy policy). */
function visitorCountry(request: Request): string | undefined {
  const country = edgeCountry.safeParse(request.cf).data?.country;

  return country && !NO_COUNTRY.has(country) ? country : undefined;
}

/**
 * Drops malformed SDK attributes before a single bad AnyValue can reject the
 * batch, repairs split UTF-16 surrogates, stamps the edge country, and filters
 * spans to OpenObserve's five-hour past / 24-hour future window using start time.
 * Unknown/non-OTLP bodies retain the existing passthrough behavior.
 */
function prepareJson(json: string, country: string | undefined): string | null {
  let body;
  let changed = false;

  try {
    body = JSON.parse(json, (key, value: unknown) => {
      if (Object(value) instanceof String) {
        const text = String(value);
        // Under /u, valid surrogate pairs are one code point and remain intact.
        const wellFormed = text.replace(/[\uD800-\uDFFF]/gu, "\uFFFD");
        changed ||= text !== wellFormed;

        return wellFormed;
      }

      if ((key === "attributes" || key === "links") && Array.isArray(value)) {
        const schema = key === "attributes" ? otlpAttribute : otlpIds;
        const kept = value.filter((entry) => schema.safeParse(entry).success);
        changed ||= kept.length !== value.length;

        return kept;
      }

      if (key === "body" && value !== null && !otlpValue.safeParse(value).success) {
        changed = true;

        return undefined;
      }

      return value;
    });
  } catch {
    return json;
  }

  const parsed = otlpPayload.safeParse(body);

  if (!parsed.success || (!parsed.data.resourceSpans && !parsed.data.resourceLogs)) return json;

  const { resourceSpans = [], resourceLogs = [] } = parsed.data;

  const now = Date.now();
  const minTime = BigInt(now - OTEL_BROWSER_MAX_SPAN_AGE_MS) * 1_000_000n;
  const maxTime = BigInt(now + OTEL_BROWSER_MAX_SPAN_FUTURE_MS) * 1_000_000n;
  let spanCount = 0;
  let keptCount = 0;

  for (const batch of resourceSpans) {
    for (const scope of batch.scopeSpans ?? []) {
      if (!scope.spans) continue;
      spanCount += scope.spans.length;
      const spans = scope.spans.filter((span) => {
        const parsedSpan = otlpSpan.safeParse(span);

        if (!parsedSpan.success) return false;
        const timestamp = BigInt(parsedSpan.data.startTimeUnixNano);

        return timestamp >= minTime && timestamp <= maxTime;
      });

      keptCount += spans.length;
      if (spans.length !== scope.spans.length) {
        scope.spans = spans;
        changed = true;
      }
    }
  }

  if (spanCount > 0 && keptCount === 0 && resourceLogs.length === 0) return null;

  if (country) {
    for (const batch of [...resourceSpans, ...resourceLogs]) {
      const resource = (batch.resource ??= {});
      const attributes = (resource.attributes ?? []).filter(({ key }) => key !== COUNTRY_KEY);

      resource.attributes = [...attributes, { key: COUNTRY_KEY, value: { stringValue: country } }];
      changed = true;
    }
  }

  return changed || country ? JSON.stringify(parsed.data) : json;
}

/** Inflates a gzip body, or `null` when it is corrupt or expands past `MAX_INFLATED_BYTES`. */
async function gunzip(body: ArrayBuffer): Promise<ArrayBuffer | null> {
  const reader = new Blob([body]).stream().pipeThrough(new DecompressionStream("gzip")).getReader();

  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();

      if (done) break;
      total += value.byteLength;

      if (total > MAX_INFLATED_BYTES) {
        await reader.cancel();

        return null;
      }

      chunks.push(value);
    }
  } catch {
    return null;
  }

  const inflated = new Uint8Array(total);
  let offset = 0;

  for (const chunk of chunks) {
    inflated.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return inflated.buffer;
}

/**
 * JSON batches (traces, console logs) gain the visitor's country and lose
 * email addresses and URL query strings; traces also lose invalid or stale
 * spans. Gzip is inflated before inspection and forwarded uncompressed.
 * Uninspectable gzip is dropped. Other encodings retain passthrough behavior;
 * session replay stays off because its protobuf cannot be scrubbed here.
 *
 * `null` means drop the batch.
 */
async function prepareBody(
  body: ArrayBuffer,
  headers: Headers,
  country: string | undefined,
): Promise<ArrayBuffer | string | null> {
  if (!headers.get("content-type")?.startsWith("application/json")) return body;

  const encoding = headers.get("content-encoding");
  let plain: ArrayBuffer | null = body;

  if (encoding === "gzip") {
    plain = await gunzip(body);

    if (plain === null) return null;
    headers.delete("content-encoding");
  } else if (!UNCOMPRESSED.has(encoding)) {
    return body;
  }

  const json = prepareJson(new TextDecoder().decode(plain), country);

  // Serialize before scrubbing: escaped `\u0040` must become a literal `@`.
  return json === null ? null : redactEmails(json).replace(URL_QUERY, "$1");
}

const otlpPartialSuccess = z.object({
  partialSuccess: z.object({
    rejectedSpans: z.coerce.number().int().nonnegative().optional(),
    rejectedLogRecords: z.coerce.number().int().nonnegative().optional(),
  }),
});

/** Read a bounded OTLP/error prefix; discard a cut-off token before redaction. */
async function collectorResponseBody(response: Response, key: string): Promise<string> {
  const reader = response.body?.getReader();

  if (!reader) return "";
  const bytes = new Uint8Array(OTEL_COLLECTOR_ERROR_BODY_BYTES);
  let length = 0;
  let truncated = false;

  try {
    while (length < bytes.length) {
      const { done, value } = await reader.read();

      if (done) break;
      const count = Math.min(value.byteLength, bytes.length - length);
      bytes.set(value.subarray(0, count), length);
      length += count;
      truncated = length === bytes.length;
    }
  } finally {
    await reader.cancel();
  }

  let text = new TextDecoder().decode(bytes.subarray(0, length));

  // A key/email/query cut at the byte cap must not leave a sensitive prefix.
  if (truncated) text = text.replace(/\S+$/, "[truncated]");
  for (const secret of [key, key.replace(/^\S+\s+/, "")]) {
    if (secret) text = text.replaceAll(secret, "[redacted]");
  }

  return redactEmails(text)
    .replace(URL_QUERY, "$1")
    .replace(/\b(Basic|Bearer)\s+[^\s"<>\\]+/gi, "$1 [redacted]")
    .replace(/(https?:\/\/)[^/\s"<>]+@/gi, "$1[redacted]@")
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, "[ip]")
    .replace(/(?<![0-9a-f:])(?:[0-9a-f]{0,4}:){2,}[0-9a-f]{0,4}(?![0-9a-f:])/gi, "[ip]")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .slice(0, OTEL_COLLECTOR_ERROR_BODY_BYTES);
}

/**
 * The browser already got its 202. Keep reading/cancelling inside the collector
 * timeout. OTLP can report rejected records inside an HTTP 200 partialSuccess.
 */
async function forward(
  signal: OtelSignal,
  url: string,
  headers: Headers,
  body: ArrayBuffer | string,
): Promise<void> {
  let httpStatus: number | undefined;
  let rejected = false;

  try {
    await collectorCall(async (abort) => {
      const response = await fetch(url, { method: "POST", headers, body, signal: abort });

      httpStatus = response.status;
      rejected = !response.ok || response.status === 206;
      if (!rejected && !response.headers.get("content-type")?.startsWith("application/json")) {
        await response.body?.cancel();

        return;
      }

      const upstreamBody = await collectorResponseBody(response, headers.get("authorization") ?? "");
      let rejectedRecords = 0;

      if (response.ok) {
        try {
          const partial = otlpPartialSuccess.safeParse(JSON.parse(upstreamBody));

          if (partial.success) {
            rejectedRecords =
              (signal === "traces"
                ? partial.data.partialSuccess.rejectedSpans
                : partial.data.partialSuccess.rejectedLogRecords) ?? 0;
          }
        } catch {
          // A truncated/non-JSON prefix is diagnostic text, not an OTLP response.
        }
      }

      if (rejected || rejectedRecords > 0) {
        ingestLog.error("Collector rejected browser telemetry", {
          signal,
          http_status: httpStatus,
          upstream_body: upstreamBody,
          rejected_records: rejectedRecords || undefined,
        });
      }
    });
  } catch (error) {
    ingestLog.error(
      rejected
        ? "Collector rejected browser telemetry"
        : "Collector unreachable for browser telemetry",
      {
        signal,
        http_status: httpStatus,
        ...errorFields(error instanceof CollectorCallFailed ? error.cause : error),
        timed_out: error instanceof CollectorCallTimedOut,
      },
    );
  }
}

export async function handleOtelIngest(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const signal = SIGNAL_PATH.exec(new URL(request.url).pathname)?.[1];

  if (!isSignal(signal)) return new Response(null, { status: 404 });

  if (request.method !== "POST")
    return new Response(null, { status: 405, headers: { Allow: "POST" } });

  const collector = env.OTEL_COLLECTOR_URL;
  const key = env.OTEL_BROWSER_INGEST_KEY;

  // Unconfigured: accept and drop, so the SDK doesn't retry into a dead end.
  if (!collector || !key) return new Response(null, { status: 204 });

  // The SDK always sends a sized body, so requiring the length keeps the cap
  // check ahead of the read.
  const declared = request.headers.get("content-length") ?? "";

  if (!/^\d+$/.test(declared)) return new Response(null, { status: 411 });

  if (Number(declared) > MAX_BODY_BYTES) return new Response(null, { status: 413 });

  const body = await request.arrayBuffer();

  if (body.byteLength > MAX_BODY_BYTES) return new Response(null, { status: 413 });

  // Only the content headers cross over; the client's authorization is replaced by the server key.
  const headers = new Headers({ authorization: key });

  for (const name of FORWARDED_HEADERS) {
    const value = request.headers.get(name);

    if (value) headers.set(name, value);
  }

  const endpoint = `${collector.replace(/\/+$/, "")}/v1/${signal}`;
  const country = visitorCountry(request);

  ctx.waitUntil(
    prepareBody(body, headers, country).then((prepared) => {
      if (prepared === null) {
        ingestLog.warn("Dropped an unreadable, malformed, or out-of-window browser telemetry batch", {
          signal,
        });

        return;
      }

      return forward(signal, endpoint, headers, prepared);
    }),
  );

  return new Response(null, { status: 202 });
}
