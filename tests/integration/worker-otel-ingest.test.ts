import handler from "@tanstack/react-start/server-entry";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import worker from "@/worker";
import { COLLECTOR_TIMEOUT_MS } from "@/lib/config";
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
    expect(headers.get("uptrace-dsn")).toBe("ingest-key");
    expect(headers.get("authorization")).toBeNull();
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
    expect(logged).not.toContain("uptrace-dsn");
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

    await handleOtelIngest(otlp("/otel/v1/traces", "{}"), env, ctx);
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
