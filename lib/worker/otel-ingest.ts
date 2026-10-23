/**
 * Same-origin ingest for the browser telemetry SDK.
 *
 * The page posts OTLP to `/otel/v1/{traces,logs}`, and the Worker forwards it
 * to the collector with the ingestion key attached. The key never ships to the
 * browser, and the CSP needs no third-party `connect-src`. This runs ahead of
 * vinext and auth, so a telemetry batch costs one cheap Worker hop.
 */
import { errorFields, log, redactEmails } from "@/lib/log";
import type { Env } from "@/lib/types/env";

const OTEL_PATH = /^\/otel(\/|$)/;

const SIGNAL_PATH = /^\/otel\/v1\/(traces|logs)$/;

const SIGNALS = ["traces", "logs"] as const;

type OtelSignal = (typeof SIGNALS)[number];

function isSignal(value: string | undefined): value is OtelSignal {
  return SIGNALS.some((signal) => signal === value);
}

const MAX_BODY_BYTES = 1024 * 1024;

const UPSTREAM_TIMEOUT_MS = 10_000;

const FORWARDED_HEADERS = ["content-type", "content-encoding"] as const;

// A query string or fragment can carry a token or an admin search term.
// Backslash stops the match so an escaped quote inside a JSON string survives.
const URL_QUERY = /(https?:\/\/[^\s"?#\\]*)[?#][^\s"\\]*/gi;

const UNCOMPRESSED = new Set([null, "identity"]);

const ingestLog = log("OtelIngest");

export function isOtelIngestPath(pathname: string): boolean {
  return OTEL_PATH.test(pathname);
}

/**
 * Uncompressed JSON batches (traces, console logs) lose email addresses and
 * URL query strings before they leave the Worker. Anything else, such as the
 * gzipped protobuf of session replay, passes through untouched; the SDK masks
 * replay text and inputs.
 */
function scrubBody(body: ArrayBuffer, headers: Headers): ArrayBuffer | string {
  const isPlainJson =
    headers.get("content-type")?.startsWith("application/json") &&
    UNCOMPRESSED.has(headers.get("content-encoding"));

  if (!isPlainJson) return body;

  return redactEmails(new TextDecoder().decode(body)).replace(URL_QUERY, "$1");
}

/**
 * The browser already got its 202, so a rejected key or a down collector only
 * shows up here. Logged at error so it alerts; the headers (and key) never are.
 */
async function forward(
  signal: OtelSignal,
  url: string,
  headers: Headers,
  body: ArrayBuffer | string,
): Promise<void> {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers,
      body,
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });

    await response.body?.cancel();

    if (!response.ok)
      ingestLog.error("Collector rejected browser telemetry", {
        signal,
        http_status: response.status,
      });
  } catch (error) {
    ingestLog.error("Collector unreachable for browser telemetry", {
      signal,
      ...errorFields(error),
    });
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

  // Only the content headers cross over; a client-sent authorization never does.
  const headers = new Headers({ authorization: key });

  for (const name of FORWARDED_HEADERS) {
    const value = request.headers.get(name);

    if (value) headers.set(name, value);
  }

  const endpoint = `${collector.replace(/\/+$/, "")}/v1/${signal}`;
  ctx.waitUntil(forward(signal, endpoint, headers, scrubBody(body, headers)));

  return new Response(null, { status: 202 });
}
