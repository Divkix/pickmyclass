import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vite-plus/test";
import sitemap from "@/app/sitemap";
import {
  INDEXNOW_ENDPOINT,
  INDEXNOW_KEY,
  type IndexNowRuntime,
  indexNowBody,
  sitemapUrls,
  submitSitemapToIndexNow,
} from "@/lib/seo/indexnow";

const KEY_URL = `https://pickmyclass.app/${INDEXNOW_KEY}.txt`;

const SITEMAP_URL = "https://pickmyclass.app/sitemap.xml";

const SITEMAP = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
<url><loc>https://pickmyclass.app/</loc></url>
<url><loc>https://pickmyclass.app/faq</loc></url>
<url><loc> https://pickmyclass.app/blog?a=1&amp;b=2 </loc></url>
<url><loc>https://pickmyclass.app/faq</loc></url>
<url><loc>https://elsewhere.example/page</loc></url>
</urlset>`;

type Route = (init?: RequestInit) => Response | Promise<Response>;

function runtimeWith(routes: Readonly<Record<string, Route>>, attempts = 3) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const route = routes[String(input)];

    return route ? route(init) : new Response("not found", { status: 404 });
  });

  const sleep = vi.fn(async () => {});
  const runtime: IndexNowRuntime = { fetch: fetchMock, sleep, attempts, delayMs: 5 };

  return { runtime, fetchMock, sleep };
}

function postBody(fetchMock: ReturnType<typeof runtimeWith>["fetchMock"]) {
  const call = fetchMock.mock.calls.find(([input]) => String(input) === INDEXNOW_ENDPOINT);

  return JSON.parse(String(call?.[1]?.body));
}

describe("sitemapUrls", () => {
  it("extracts, trims, decodes and dedupes our own <loc> URLs", () => {
    expect(sitemapUrls(SITEMAP)).toEqual([
      "https://pickmyclass.app/",
      "https://pickmyclass.app/faq",
      "https://pickmyclass.app/blog?a=1&b=2",
    ]);
  });

  it("returns nothing for a page that is not a sitemap", () => {
    expect(sitemapUrls("<html>oops</html>")).toEqual([]);
  });
});

describe("indexNowBody", () => {
  it("names the host, key and key file", () => {
    expect(JSON.parse(indexNowBody(["https://pickmyclass.app/"]))).toEqual({
      host: "pickmyclass.app",
      key: INDEXNOW_KEY,
      keyLocation: KEY_URL,
      urlList: ["https://pickmyclass.app/"],
    });
  });

  it("caps the list at the 10,000-URL protocol limit", () => {
    const urls = Array.from({ length: 10_001 }, (_, i) => `https://pickmyclass.app/${i}`);

    expect(JSON.parse(indexNowBody(urls)).urlList).toHaveLength(10_000);
  });
});

describe("submitSitemapToIndexNow", () => {
  it("posts every sitemap URL once the key file is live", async () => {
    const { runtime, fetchMock } = runtimeWith({
      [KEY_URL]: () => new Response(INDEXNOW_KEY),
      [SITEMAP_URL]: () => new Response(SITEMAP),
      [INDEXNOW_ENDPOINT]: () => new Response(null, { status: 202 }),
    });

    await expect(submitSitemapToIndexNow(runtime)).resolves.toEqual({
      kind: "submitted",
      httpStatus: 202,
      urlCount: 3,
    });

    const call = fetchMock.mock.calls.find(([input]) => String(input) === INDEXNOW_ENDPOINT);

    expect(call?.[1]?.method).toBe("POST");
    expect(new Headers(call?.[1]?.headers).get("content-type")).toBe(
      "application/json; charset=utf-8",
    );
    expect(postBody(fetchMock).urlList).toHaveLength(3);
  });

  it("waits for the new deployment to serve the key file", async () => {
    let keyReads = 0;

    const { runtime, sleep } = runtimeWith({
      [KEY_URL]: () =>
        ++keyReads < 3 ? new Response("missing", { status: 404 }) : new Response(INDEXNOW_KEY),
      [SITEMAP_URL]: () => new Response(SITEMAP),
      [INDEXNOW_ENDPOINT]: () => new Response(null, { status: 200 }),
    });

    await expect(submitSitemapToIndexNow(runtime)).resolves.toMatchObject({ kind: "submitted" });
    expect(keyReads).toBe(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("skips without posting when the key file never goes live", async () => {
    const { runtime, fetchMock, sleep } = runtimeWith({
      [KEY_URL]: () => new Response("wrong-key"),
    });

    await expect(submitSitemapToIndexNow(runtime)).resolves.toMatchObject({ kind: "skipped" });
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.some(([input]) => String(input) === INDEXNOW_ENDPOINT)).toBe(false);
  });

  it("skips when the sitemap is empty", async () => {
    const { runtime } = runtimeWith({
      [KEY_URL]: () => new Response(INDEXNOW_KEY),
      [SITEMAP_URL]: () => new Response("<urlset></urlset>"),
    });

    await expect(submitSitemapToIndexNow(runtime)).resolves.toEqual({
      kind: "skipped",
      reason: "sitemap unavailable or empty",
    });
  });

  it("reports a rejected submission instead of throwing", async () => {
    const { runtime } = runtimeWith({
      [KEY_URL]: () => new Response(INDEXNOW_KEY),
      [SITEMAP_URL]: () => new Response(SITEMAP),
      [INDEXNOW_ENDPOINT]: () => new Response("Key not valid", { status: 403 }),
    });

    await expect(submitSitemapToIndexNow(runtime)).resolves.toEqual({
      kind: "skipped",
      reason: "IndexNow answered 403: Key not valid",
    });
  });

  it("survives network errors", async () => {
    const { runtime } = runtimeWith({
      [KEY_URL]: () => new Response(INDEXNOW_KEY),
      [SITEMAP_URL]: () => new Response(SITEMAP),
      [INDEXNOW_ENDPOINT]: () => {
        throw new Error("ECONNRESET");
      },
    });

    await expect(submitSitemapToIndexNow(runtime)).resolves.toEqual({
      kind: "skipped",
      reason: "IndexNow request failed: ECONNRESET",
    });
  });

  it("submits every URL of the real sitemap", async () => {
    const entries = await sitemap();
    const xml = entries.map((entry) => `<url><loc>${entry.url}</loc></url>`).join("");

    expect(sitemapUrls(xml)).toEqual(entries.map((entry) => entry.url));
  });
});

describe("IndexNow key file", () => {
  it("is published from public/ and contains only the key", () => {
    const file = join(process.cwd(), "public", `${INDEXNOW_KEY}.txt`);

    expect(existsSync(file)).toBe(true);
    expect(readFileSync(file, "utf8")).toBe(INDEXNOW_KEY);
    expect(INDEXNOW_KEY).toMatch(/^[a-zA-Z0-9-]{8,128}$/);
  });
});
