/**
 * Same-origin ingest for the browser telemetry SDK.
 *
 * The page posts OTLP to `/otel/v1/{traces,logs}`, and the Worker forwards it
 * to the collector with the ingestion key attached. The key never ships to the
 * browser, and the CSP needs no third-party `connect-src`. This runs ahead of
 * vinext and auth, so a telemetry batch costs one cheap Worker hop.
 */
import { z } from "zod";
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

const COUNTRY_KEY = "geo.country.iso_code";

// Cloudflare's codes for Tor exits (T1) and unknown origins (XX).
const NO_COUNTRY = new Set(["T1", "XX"]);

const edgeCountry = z.object({ country: z.string().optional() });

// Only the path to each resource's attributes is checked; looseObject keeps
// every other field of the batch as sent.
const otlpResourceBatch = z.looseObject({
  resource: z
    .looseObject({ attributes: z.array(z.looseObject({ key: z.string() })).optional() })
    .optional(),
});

const otlpPayload = z.looseObject({
  resourceSpans: z.array(otlpResourceBatch).optional(),
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
 * Stamps the country on every resource so HyperDX can group browser telemetry
 * by `ResourceAttributes['geo.country.iso_code']`, replacing any client-sent
 * value. A body that isn't an OTLP object passes through as is.
 */
function tagCountry(json: string, country: string): string {
  let body;

  try {
    body = JSON.parse(json);
  } catch {
    return json;
  }

  const parsed = otlpPayload.safeParse(body);

  if (!parsed.success) return json;

  const { resourceSpans = [], resourceLogs = [] } = parsed.data;

  for (const batch of [...resourceSpans, ...resourceLogs]) {
    const resource = (batch.resource ??= {});
    const attributes = (resource.attributes ?? []).filter(({ key }) => key !== COUNTRY_KEY);

    resource.attributes = [...attributes, { key: COUNTRY_KEY, value: { stringValue: country } }];
  }

  return JSON.stringify(parsed.data);
}

/**
 * Uncompressed JSON batches (traces, console logs) gain the visitor's country
 * and lose email addresses and URL query strings before they leave the Worker.
 * Anything else, such as the gzipped protobuf of session replay, passes through
 * untouched; the SDK masks replay text and inputs.
 */
function prepareBody(
  body: ArrayBuffer,
  headers: Headers,
  country: string | undefined,
): ArrayBuffer | string {
  const isPlainJson =
    headers.get("content-type")?.startsWith("application/json") &&
    UNCOMPRESSED.has(headers.get("content-encoding"));

  if (!isPlainJson) return body;

  const json = new TextDecoder().decode(body);

  // Tag before scrubbing: re-serializing turns an escaped `\u0040` into a
  // literal `@` that redactEmails must still see.
  return redactEmails(country ? tagCountry(json, country) : json).replace(URL_QUERY, "$1");
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
  ctx.waitUntil(
    forward(signal, endpoint, headers, prepareBody(body, headers, visitorCountry(request))),
  );

  return new Response(null, { status: 202 });
}
