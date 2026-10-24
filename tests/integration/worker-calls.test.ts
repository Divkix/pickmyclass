import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import type { Env } from "@/lib/types/env";
import { collectorCall, edgeCacheCall, fetchAsset } from "@/lib/worker/calls";
import { createEdgeHtmlCache } from "@/lib/worker/edge-html-cache";
import {
  AssetsFetchFailed,
  AssetsFetchTimedOut,
  CollectorCallFailed,
  EdgeCacheFailed,
  EdgeCacheTimedOut,
} from "@/lib/worker/errors";

async function caught(promise: Promise<unknown>): Promise<Error | undefined> {
  return promise.then(
    () => undefined,
    (error: Error) => error,
  );
}

const request = new Request("https://pickmyclass.app/");

describe("worker outbound calls", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("times out a cache operation that never settles", async () => {
    vi.useFakeTimers();
    const pending = caught(edgeCacheCall("match", () => new Promise(() => {}), 30));

    await vi.advanceTimersByTimeAsync(30);
    const error = await pending;

    expect(error).toBeInstanceOf(EdgeCacheTimedOut);
    expect(error).toMatchObject({ operation: "match", timeoutMs: 30 });
  });

  it("wraps a cache failure with its operation", async () => {
    const error = await caught(edgeCacheCall("put", () => Promise.reject(new Error("quota"))));

    expect(error).toBeInstanceOf(EdgeCacheFailed);
    expect(error).toMatchObject({ operation: "put", message: "quota" });
  });

  it("wraps a collector failure", async () => {
    const error = await caught(collectorCall(() => Promise.reject(new TypeError("fetch failed"))));

    expect(error).toBeInstanceOf(CollectorCallFailed);
  });

  it("wraps an assets binding failure and times out a hung one", async () => {
    // SAFETY: fetchAsset only calls assets.fetch.
    const failing = { fetch: () => Promise.reject(new Error("binding down")) } as Env["ASSETS"];

    expect(await caught(fetchAsset(failing, request))).toBeInstanceOf(AssetsFetchFailed);

    vi.useFakeTimers();
    // SAFETY: fetchAsset only calls assets.fetch.
    const hung = { fetch: () => new Promise<Response>(() => {}) } as Env["ASSETS"];
    const pending = caught(fetchAsset(hung, request, 25));

    await vi.advanceTimersByTimeAsync(25);

    expect(await pending).toBeInstanceOf(AssetsFetchTimedOut);
  });
});

describe("edge HTML cache degradation", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const html = () =>
    new Response("<html></html>", { status: 200, headers: { "content-type": "text/html" } });

  it("treats a failing cache read as a miss and logs it", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const cache = createEdgeHtmlCache(() => ({
      match: () => Promise.reject(new Error("cache down")),
      put: () => Promise.resolve(),
    }));

    expect(await cache.get(request, "v1")).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ msg: "Edge cache read failed, rendering instead" }),
    );
  });

  it("treats a hung cache read as a miss", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const cache = createEdgeHtmlCache(() => ({
      match: () => new Promise(() => {}),
      put: () => Promise.resolve(),
    }));

    const read = cache.get(request, "v1");

    await vi.advanceTimersByTimeAsync(3_000);

    expect(await read).toBeUndefined();
  });

  it("logs a failed cache write instead of rejecting the waitUntil promise", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const cache = createEdgeHtmlCache(() => ({
      match: () => Promise.resolve(undefined),
      put: () => Promise.reject(new Error("quota")),
    }));

    await expect(cache.put(request, "v1", html())).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.objectContaining({ msg: "Edge cache write failed" }));
  });
});
