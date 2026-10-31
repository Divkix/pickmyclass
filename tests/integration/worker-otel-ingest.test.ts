import handler from "@tanstack/react-start/server-entry";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import worker from "@/worker";
import {
  COLLECTOR_TIMEOUT_MS,
  OTEL_BROWSER_MAX_SPAN_AGE_MS,
  OTEL_BROWSER_MAX_SPAN_FUTURE_MS,
  OTEL_COLLECTOR_ERROR_BODY_BYTES,
} from "@/lib/config";
import type { Env } from "@/lib/types/env";
import { handleOtelIngest } from "@/lib/worker/otel-ingest";

vi.mock("@/lib/queue/process-section", () => ({ processSection: vi.fn() }));

const pending: Promise<unknown>[] = [];

// SAFETY: the ingest path only calls ctx.waitUntil, collected here so tests can await the forward.
const ctx = {
  waitUntil: (promise: Promise<unknown>) => {
    pending.push(promise);
  },
  passThroughOnException: () => {},
} as ExecutionContext;

// SAFETY: the ingest path reads only the two OTEL_* keys, which the literal provides.
const env = {
  OTEL_COLLECTOR_URL: "https://otel.example.test",
  OTEL_BROWSER_INGEST_KEY: "ingest-key",
} as Env;

function otlp(path: string, body: string, headers: Record<string, string> = {}): Request {
  return new Request(`https://pickmyclass.app${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "content-length": String(new TextEncoder().encode(body).byteLength),
      ...headers,
    },
    body,
  });
}

async function gzipped(path: string, body: string): Promise<Request> {
  const compressed = await new Response(
    new Blob([body]).stream().pipeThrough(new CompressionStream("gzip")),
  ).arrayBuffer();

  return new Request(`https://pickmyclass.app${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "content-encoding": "gzip",
      "content-length": String(compressed.byteLength),
    },
    body: compressed,
  });
}

// Node's Request has no `cf`; the Worker runtime sets it from the edge.
function fromCountry(request: Request, country: string | undefined): Request {
  Object.defineProperty(request, "cf", { value: { country, city: "Tempe", region: "Arizona" } });

  return request;
}

const traceBatch = JSON.stringify({
  resourceSpans: [
    {
      resource: {
        attributes: [
          { key: "service.name", value: { stringValue: "pickmyclass-web" } },
          { key: "geo.country.iso_code", value: { stringValue: "ZZ" } },
        ],
      },
      scopeSpans: [],
    },
    { scopeSpans: [] },
  ],
});

async function forwardedJson(request: Request): Promise<string> {
  await handleOtelIngest(request, env, ctx);
  await Promise.all(pending);

  const [, init] = upstream.mock.lastCall ?? [];

  return String(init?.body);
}

const upstream = vi.fn<typeof fetch>();

describe("browser telemetry ingest", () => {
  beforeEach(() => {
    pending.length = 0;
    upstream.mockReset().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", upstream);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("forwards a batch with the server-side key and content headers only", async () => {
    const request = otlp("/otel/v1/traces", "{}", {
      authorization: "client-key",
      "content-encoding": "identity",
    });

    const response = await handleOtelIngest(request, env, ctx);
    await Promise.all(pending);

    expect(response.status).toBe(202);
    const [url, init] = upstream.mock.calls[0];
    expect(url).toBe("https://otel.example.test/v1/traces");
    const headers = new Headers(init?.headers);
    expect(headers.get("authorization")).toBe("ingest-key");
    expect(headers.get("uptrace-dsn")).toBeNull();
    expect(headers.get("content-encoding")).toBe("identity");
  });

  it("strips emails and URL query strings from plain JSON batches", async () => {
    const body = JSON.stringify({
      href: "https://pickmyclass.app/admin/users?search=student%40asu.edu&page=2",
      message: "lookup for student@asu.edu",
      nested: JSON.stringify({ email: "student@asu.edu" }),
      frame: "at fn (HTTPS://pickmyclass.app/x.js#token=abc)",
    });

    expect(JSON.parse(await forwardedJson(otlp("/otel/v1/logs", body)))).toEqual({
      href: "https://pickmyclass.app/admin/users",
      message: "lookup for [email]",
      nested: JSON.stringify({ email: "[email]" }),
      frame: "at fn (HTTPS://pickmyclass.app/x.js",
    });
  });

  it("inflates, scrubs and forwards a gzipped JSON batch uncompressed", async () => {
    const body = JSON.stringify({
      href: "https://pickmyclass.app/admin/users?search=student%40asu.edu",
      message: "lookup for student@asu.edu",
    });

    const request = fromCountry(await gzipped("/otel/v1/logs", body), "US");

    expect(JSON.parse(await forwardedJson(request))).toEqual({
      href: "https://pickmyclass.app/admin/users",
      message: "lookup for [email]",
    });
    const headers = new Headers(upstream.mock.lastCall?.[1]?.headers);
    expect(headers.has("content-encoding")).toBe(false);
    expect(headers.get("content-type")).toBe("application/json");
  });

  it("tags a gzipped trace batch with the visitor's country", async () => {
    const request = fromCountry(await gzipped("/otel/v1/traces", traceBatch), "US");

    const [resource] = JSON.parse(await forwardedJson(request)).resourceSpans;
    expect(JSON.stringify(resource)).toContain('"stringValue":"US"');
  });

  it.each([false, true])(
    "removes malformed SDK AnyValues at every OTLP attribute boundary (gzip=%s)",
    async (gzip) => {
      const valid = [
        { key: "metric", value: { doubleValue: 1.25 }, extra: "kept" },
        { key: "empty-list", value: { arrayValue: { values: [] } } },
        { key: "bytes", value: { bytesValue: "YWJj" } },
      ];

      const attributes = [
        ...valid,
        { key: "rum.sessionId", value: {} },
        { key: "nonfinite", value: { doubleValue: NaN } },
        { key: "overflow", value: { intValue: "9223372036854775808" } },
        { key: "bool", value: { boolValue: null } },
        { key: "string", value: { stringValue: null } },
        { key: "bytes", value: { bytesValue: "%%%" } },
        { key: "array", value: { arrayValue: { values: [{}] } } },
        { key: "map", value: { kvlistValue: { values: [{ key: "empty", value: {} }] } } },
        null,
      ];

      const timestamp = String(BigInt(Date.now()) * 1_000_000n);

      const span = {
        traceId: "5b8efff798038103d269b633813fc60c",
        spanId: "eee19b7ec3c1b174",
        startTimeUnixNano: timestamp,
        name: "broken\uD800\uD83D\uDE00",
        attributes,
        events: [{ name: "event", attributes }],
        links: [
          { traceId: "5b8efff798038103d269b633813fc60c", spanId: "eee19b7ec3c1b175", attributes },
          { traceId: "not-hex", spanId: "eee19b7ec3c1b175" },
        ],
      };

      const body = JSON.stringify({
        resourceSpans: [
          {
            resource: { attributes },
            scopeSpans: [{ scope: { attributes }, spans: [span, { ...span, traceId: "not-hex" }] }],
          },
        ],
      });

      const request = gzip ? await gzipped("/otel/v1/traces", body) : otlp("/otel/v1/traces", body);
      const [resource] = JSON.parse(await forwardedJson(request)).resourceSpans;
      const [scope] = resource.scopeSpans;
      const [forwarded] = scope.spans;

      expect(resource.resource.attributes).toEqual(valid);
      expect(scope.scope.attributes).toEqual(valid);
      expect(scope.spans).toHaveLength(1);
      expect(forwarded.attributes).toEqual(valid);
      expect(forwarded.events[0].attributes).toEqual(valid);
      expect(forwarded.links).toHaveLength(1);
      expect(forwarded.links[0].attributes).toEqual(valid);
      expect(forwarded.name).toBe("broken\uFFFD\uD83D\uDE00");
    },
  );

  it("removes an invalid log AnyValue body without dropping valid log records", async () => {
    const body = JSON.stringify({
      resourceLogs: [
        {
          scopeLogs: [
            {
              logRecords: [
                { body: { doubleValue: null }, attributes: [{ key: "undefined", value: {} }] },
                { body: { stringValue: "valid" } },
              ],
            },
          ],
        },
      ],
    });

    const forwarded = JSON.parse(await forwardedJson(otlp("/otel/v1/logs", body)));

    expect(forwarded.resourceLogs[0].scopeLogs[0].logRecords).toEqual([
      { attributes: [] },
      { body: { stringValue: "valid" } },
    ]);
  });

  it.each([false, true])("filters invalid and out-of-window spans (gzip=%s)", async (gzip) => {
    const now = Date.UTC(2026, 9, 29, 15);
    vi.spyOn(Date, "now").mockReturnValue(now);
    const nanos = (ms: number) => BigInt(ms) * 1_000_000n;
    const current = { name: "current", startTimeUnixNano: String(nanos(now)), extra: "kept" };

    const oldest = {
      name: "oldest",
      startTimeUnixNano: String(nanos(now - OTEL_BROWSER_MAX_SPAN_AGE_MS)),
    };

    const numeric = { name: "numeric", startTimeUnixNano: Number(nanos(now)) };

    const body = JSON.stringify({
      resourceSpans: [
        {
          scopeSpans: [
            {
              scope: { name: "browser" },
              spans: [
                current,
                oldest,
                numeric,
                { startTimeUnixNano: String(nanos(now - OTEL_BROWSER_MAX_SPAN_AGE_MS) - 1n) },
                { startTimeUnixNano: String(nanos(now + OTEL_BROWSER_MAX_SPAN_FUTURE_MS) + 1n) },
                { startTimeUnixNano: "not-a-timestamp" },
                { startTimeUnixNano: "-1" },
                { startTimeUnixNano: "1".repeat(100) },
                {},
                null,
              ],
            },
          ],
        },
        { scopeSpans: [{ spans: [{ startTimeUnixNano: "0" }] }] },
      ],
    });

    const request = gzip ? await gzipped("/otel/v1/traces", body) : otlp("/otel/v1/traces", body);
    const forwarded = JSON.parse(await forwardedJson(fromCountry(request, "US")));

    expect(forwarded.resourceSpans[0].scopeSpans[0]).toEqual({
      scope: { name: "browser" },
      spans: [current, oldest, numeric],
    });
    expect(forwarded.resourceSpans[1].scopeSpans[0].spans).toEqual([]);
    expect(forwarded.resourceSpans[0].resource.attributes).toEqual([
      { key: "geo.country.iso_code", value: { stringValue: "US" } },
    ]);
  });

  it("accepts but does not forward a batch with no spans in the ingest window", async () => {
    const body = JSON.stringify({
      resourceSpans: [{ scopeSpans: [{ spans: [{ startTimeUnixNano: "0" }] }] }],
    });

    const response = await handleOtelIngest(otlp("/otel/v1/traces", body), env, ctx);
    await Promise.all(pending);

    expect(response.status).toBe(202);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("drops a gzipped batch that inflates past the cap", async () => {
    const bomb = JSON.stringify({ message: "a".repeat(9 * 1024 * 1024) });

    await handleOtelIngest(await gzipped("/otel/v1/logs", bomb), env, ctx);
    await Promise.all(pending);

    expect(upstream).not.toHaveBeenCalled();
  });

  it("drops a batch that claims gzip but is not", async () => {
    const request = otlp("/otel/v1/logs", "student@asu.edu", { "content-encoding": "gzip" });

    await handleOtelIngest(request, env, ctx);
    await Promise.all(pending);

    expect(upstream).not.toHaveBeenCalled();
  });

  it("passes non-JSON batches through unchanged", async () => {
    const request = otlp("/otel/v1/logs", "student@asu.edu", {
      "content-type": "application/x-protobuf",
      "content-encoding": "gzip",
    });

    await handleOtelIngest(request, env, ctx);
    await Promise.all(pending);

    // SAFETY: a passthrough batch is forwarded as the raw ArrayBuffer read from the request.
    const forwarded = upstream.mock.calls[0][1]?.body as ArrayBuffer;
    expect(new TextDecoder().decode(forwarded)).toBe("student@asu.edu");
  });

  it("tags every trace and log resource with the visitor's country only", async () => {
    const traces = JSON.parse(
      await forwardedJson(fromCountry(otlp("/otel/v1/traces", traceBatch), "US")),
    );

    expect(traces.resourceSpans.map((batch: { resource: object }) => batch.resource)).toEqual([
      {
        attributes: [
          { key: "service.name", value: { stringValue: "pickmyclass-web" } },
          { key: "geo.country.iso_code", value: { stringValue: "US" } },
        ],
      },
      { attributes: [{ key: "geo.country.iso_code", value: { stringValue: "US" } }] },
    ]);

    const logBatch = JSON.stringify({ resourceLogs: [{ resource: {}, scopeLogs: [] }] });
    const logs = await forwardedJson(fromCountry(otlp("/otel/v1/logs", logBatch), "IN"));

    expect(JSON.parse(logs).resourceLogs[0].resource.attributes).toEqual([
      { key: "geo.country.iso_code", value: { stringValue: "IN" } },
    ]);
    expect(logs).not.toMatch(/Tempe|Arizona/);
  });

  it.each([undefined, "T1", "XX"])("adds no country when cf.country is %s", async (country) => {
    const body = await forwardedJson(fromCountry(otlp("/otel/v1/traces", traceBatch), country));

    expect(body).toBe(traceBatch);
  });

  it("forwards non-OTLP JSON bodies unchanged", async () => {
    for (const body of ["not json", "[1]", "null", '{"resourceSpans":{}}']) {
      expect(await forwardedJson(fromCountry(otlp("/otel/v1/logs", body), "US"))).toBe(body);
    }
  });

  it("redacts an escaped email that re-serializing the tagged batch unescapes", async () => {
    const body = '{"resourceLogs":[],"message":"student\\u0040asu.edu"}';
    const forwarded = await forwardedJson(fromCountry(otlp("/otel/v1/logs", body), "US"));

    expect(JSON.parse(forwarded).message).toBe("[email]");
  });

  it("accepts and drops batches while the ingest key is unset", async () => {
    // SAFETY: models the deploy before the owner sets the secret; only the collector var exists.
    const unconfigured = { OTEL_COLLECTOR_URL: "https://otel.example.test" } as Env;

    const response = await handleOtelIngest(otlp("/otel/v1/traces", "{}"), unconfigured, ctx);

    expect(response.status).toBe(204);
    expect(pending).toHaveLength(0);
  });

  it("rejects unknown signals, other methods and oversized or unsized bodies", async () => {
    const statusOf = async (request: Request) => (await handleOtelIngest(request, env, ctx)).status;

    expect(await statusOf(otlp("/otel/v1/metrics", "{}"))).toBe(404);
    expect(await statusOf(new Request("https://pickmyclass.app/otel/v1/traces"))).toBe(405);
    expect(await statusOf(otlp("/otel/v1/traces", "{}", { "content-length": "2000000" }))).toBe(
      413,
    );

    const unsized = otlp("/otel/v1/traces", "{}");
    unsized.headers.delete("content-length");
    expect(await statusOf(unsized)).toBe(411);
    expect(await statusOf(otlp("/otel/v1/traces", "{}", { "content-length": "-1" }))).toBe(411);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("logs collector failures at error level without the key", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const keyed = { ...env, OTEL_BROWSER_INGEST_KEY: "sekret-ingest-key-4f9a" };

    upstream
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockRejectedValueOnce(new TypeError("fetch failed"));

    await handleOtelIngest(otlp("/otel/v1/traces", "{}"), keyed, ctx);
    await handleOtelIngest(otlp("/otel/v1/logs", "{}"), keyed, ctx);
    await Promise.all(pending);

    // The two forwards settle concurrently, so order isn't asserted.
    expect(error).toHaveBeenCalledTimes(2);
    expect(error.mock.calls.map(([line]) => line)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: "error",
          msg: "Collector rejected browser telemetry",
          signal: "traces",
          http_status: 401,
        }),
        expect.objectContaining({
          level: "error",
          msg: "Collector unreachable for browser telemetry",
          signal: "logs",
          "error.name": "TypeError",
        }),
      ]),
    );

    const logged = JSON.stringify(error.mock.calls);

    expect(logged).not.toContain(keyed.OTEL_BROWSER_INGEST_KEY);
    expect(logged).not.toContain("authorization");
  });

  it("logs the bounded rejection body after scrubbing credentials, emails and URL queries", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const token = "secret-collector-token";
    const keyed = { ...env, OTEL_BROWSER_INGEST_KEY: `Basic ${token}` };
    upstream.mockResolvedValueOnce(
      new Response(
        `outside ingestion window student@asu.edu https://example.test/path?token=private ` +
          `https://user:password@example.test/path?token=private Bearer another-secret ` +
          `192.0.2.10 2001:db8::1 \u0000\u001b Basic ${token} ${token} ${"details ".repeat(500)}`,
        { status: 400 },
      ),
    );

    await handleOtelIngest(otlp("/otel/v1/traces", "{}"), keyed, ctx);
    await Promise.all(pending);

    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({
        msg: "Collector rejected browser telemetry",
        http_status: 400,
        upstream_body: expect.stringContaining("outside ingestion window"),
      }),
    );
    const body = error.mock.calls[0][0].upstream_body;
    expect(body.length).toBeLessThanOrEqual(OTEL_COLLECTOR_ERROR_BODY_BYTES);
    expect(body).toContain("[email]");
    expect(body).not.toMatch(
      /secret-collector-token|student@asu\.edu|token=private|password|another-secret|192\.0\.2\.10|2001:db8::1|[\u0000-\u001f\u007f]/,
    );
  });

  it("cancels a rejection body after the bounded prefix without leaking a cut-off key", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const cancelled = vi.fn();
    const token = "secret-collector-token";
    const keyed = { ...env, OTEL_BROWSER_INGEST_KEY: `Basic ${token}` };

    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            `${"x ".repeat(OTEL_COLLECTOR_ERROR_BODY_BYTES / 2 - 3)}${token}`,
          ),
        );
      },
      cancel: cancelled,
    });

    upstream.mockResolvedValueOnce(new Response(body, { status: 400 }));

    await handleOtelIngest(otlp("/otel/v1/traces", "{}"), keyed, ctx);
    await Promise.all(pending);

    expect(cancelled).toHaveBeenCalled();
    expect(JSON.stringify(error.mock.calls)).not.toContain("secret");
  });

  it.each([
    ["traces", "rejectedSpans", "2", 200],
    ["logs", "rejectedLogRecords", 3, 200],
    ["traces", "rejectedSpans", "4", 206],
  ] as const)(
    "reports partial rejections for %s without retrying",
    async (signal, field, count, status) => {
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      upstream.mockResolvedValueOnce(
        Response.json(
          { partialSuccess: { [field]: count, errorMessage: "outside ingest window" } },
          { status },
        ),
      );

      await handleOtelIngest(otlp(`/otel/v1/${signal}`, "{}"), env, ctx);
      await Promise.all(pending);

      expect(upstream).toHaveBeenCalledTimes(1);
      expect(error).toHaveBeenCalledWith(
        expect.objectContaining({
          msg: "Collector rejected browser telemetry",
          signal,
          http_status: status,
          rejected_records: Number(count),
          upstream_body: expect.stringContaining("outside ingest window"),
        }),
      );
    },
  );

  it("does not log a clean JSON collector success as a rejection", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    upstream.mockResolvedValueOnce(Response.json({ partialSuccess: { rejectedSpans: "0" } }));

    await handleOtelIngest(otlp("/otel/v1/traces", "{}"), env, ctx);
    await Promise.all(pending);

    expect(error).not.toHaveBeenCalled();
  });

  it("bounds a stalled rejection body read and retains the upstream status", async () => {
    vi.useFakeTimers();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    upstream.mockResolvedValueOnce(new Response(new ReadableStream(), { status: 400 }));

    const response = await handleOtelIngest(otlp("/otel/v1/traces", "{}"), env, ctx);
    expect(response.status).toBe(202);
    await vi.advanceTimersByTimeAsync(COLLECTOR_TIMEOUT_MS);
    await Promise.all(pending);

    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({
        msg: "Collector rejected browser telemetry",
        http_status: 400,
        timed_out: true,
      }),
    );
  });

  it("gives up on a collector that never answers and aborts the request", async () => {
    vi.useFakeTimers();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    let aborted = false;

    upstream.mockImplementationOnce(
      (_url, init) =>
        new Promise<Response>(() => {
          init?.signal?.addEventListener("abort", () => {
            aborted = true;
          });
        }),
    );

    const response = await handleOtelIngest(otlp("/otel/v1/traces", "{}"), env, ctx);
    expect(response.status).toBe(202);
    expect(pending).toHaveLength(1);
    expect(aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(COLLECTOR_TIMEOUT_MS);
    await Promise.all(pending);
    vi.useRealTimers();

    expect(aborted).toBe(true);
    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({
        msg: "Collector unreachable for browser telemetry",
        timed_out: true,
      }),
    );
  });

  it("answers ahead of the app router", async () => {
    const render = vi.spyOn(handler, "fetch");

    const response = await worker.fetch(new Request("https://pickmyclass.app/otel/x"), env, ctx);

    expect(response.status).toBe(404);
    expect(render).not.toHaveBeenCalled();
  });
});
