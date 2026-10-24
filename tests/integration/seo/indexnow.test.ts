import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { INDEXNOW_ENDPOINT, INDEXNOW_KEY, submitSitemapToIndexNow } from "@/lib/seo/indexnow";
import { SITE_ORIGIN } from "@/lib/seo/public-pages";

const keyUrl = `${SITE_ORIGIN}/${INDEXNOW_KEY}.txt`;
const sitemap = `<urlset><url><loc>${SITE_ORIGIN}/a</loc></url></urlset>`;

function runtime(fetch: typeof globalThis.fetch, timeoutMs = 50) {
  return { fetch, sleep: () => Promise.resolve(), attempts: 2, delayMs: 0, timeoutMs };
}

describe("submitSitemapToIndexNow", () => {
  afterEach(() => vi.useRealTimers());

  it("submits the sitemap URLs once the key file is live", async () => {
    const fetch = vi.fn((url: string | URL | Request) =>
      Promise.resolve(
        String(url) === keyUrl
          ? new Response(INDEXNOW_KEY)
          : String(url) === INDEXNOW_ENDPOINT
            ? new Response("", { status: 202 })
            : new Response(sitemap),
      ),
    );

    expect(await submitSitemapToIndexNow(runtime(fetch))).toEqual({
      kind: "submitted",
      httpStatus: 202,
      urlCount: 1,
    });
  });

  it("gives up on a key file that never answers instead of hanging the deploy", async () => {
    vi.useFakeTimers();

    const fetch = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    );

    const outcome = submitSitemapToIndexNow(runtime(fetch));

    await vi.advanceTimersByTimeAsync(200);

    expect(await outcome).toEqual({
      kind: "skipped",
      reason: expect.stringContaining("timed out after 50ms"),
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("reports the last attempt's reason, not the first", async () => {
    const keyReplies = [new Response("", { status: 503 }), new Response("an-old-key")];
    const fetch = vi.fn(() => Promise.resolve(keyReplies.shift() ?? new Response(INDEXNOW_KEY)));

    expect(await submitSitemapToIndexNow(runtime(fetch))).toEqual({
      kind: "skipped",
      reason: `key file not live at ${keyUrl}: ${keyUrl} does not hold the key`,
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("says why the sitemap was unavailable", async () => {
    const fetch = vi.fn((url: string | URL | Request) =>
      Promise.resolve(
        String(url) === keyUrl ? new Response(INDEXNOW_KEY) : new Response("", { status: 503 }),
      ),
    );

    expect(await submitSitemapToIndexNow(runtime(fetch))).toEqual({
      kind: "skipped",
      reason: expect.stringContaining("answered 503"),
    });
  });

  it("reports a rejected submission with its status and body", async () => {
    const fetch = vi.fn((url: string | URL | Request) =>
      Promise.resolve(
        String(url) === keyUrl
          ? new Response(INDEXNOW_KEY)
          : String(url) === INDEXNOW_ENDPOINT
            ? new Response("bad key", { status: 403 })
            : new Response(sitemap),
      ),
    );

    expect(await submitSitemapToIndexNow(runtime(fetch))).toEqual({
      kind: "skipped",
      reason: "IndexNow answered 403: bad key",
    });
  });
});
