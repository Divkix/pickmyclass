import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { Env } from "@/lib/types/env";
import { handleOtelIngest } from "@/lib/worker/otel-ingest";

vi.mock("@/lib/queue/process-section", () => ({ processSection: vi.fn() }));

const worker = (await import("@/worker")).default;

const handler = (await import("vinext/server/app-router-entry")).default;

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

describe("browser telemetry ingest", () => {
  const upstream = vi.fn<typeof fetch>();

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
    expect(headers.get("authorization")).toBe("ingest-key");
    expect(headers.get("content-encoding")).toBe("identity");
  });

  it("strips emails and URL query strings from plain JSON batches", async () => {
    const body = JSON.stringify({
      href: "https://pickmyclass.app/admin/users?search=student%40asu.edu&page=2",
      message: "lookup for student@asu.edu",
      nested: JSON.stringify({ email: "student@asu.edu" }),
      frame: "at fn (HTTPS://pickmyclass.app/x.js#token=abc)",
    });

    await handleOtelIngest(otlp("/otel/v1/logs", body), env, ctx);
    await Promise.all(pending);

    expect(JSON.parse(String(upstream.mock.calls[0][1]?.body))).toEqual({
      href: "https://pickmyclass.app/admin/users",
      message: "lookup for [email]",
      nested: JSON.stringify({ email: "[email]" }),
      frame: "at fn (HTTPS://pickmyclass.app/x.js",
    });
  });

  it("passes compressed batches through unchanged", async () => {
    const request = otlp("/otel/v1/logs", "student@asu.edu", { "content-encoding": "gzip" });

    await handleOtelIngest(request, env, ctx);
    await Promise.all(pending);

    // SAFETY: a compressed batch is forwarded as the raw ArrayBuffer read from the request.
    const forwarded = upstream.mock.calls[0][1]?.body as ArrayBuffer;
    expect(new TextDecoder().decode(forwarded)).toBe("student@asu.edu");
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

  it("answers ahead of the app router", async () => {
    const render = vi.spyOn(handler, "fetch");

    const response = await worker.fetch(new Request("https://pickmyclass.app/otel/x"), env, ctx);

    expect(response.status).toBe(404);
    expect(render).not.toHaveBeenCalled();
  });
});
