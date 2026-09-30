import { SITE_ORIGIN } from "@/lib/seo/public-pages";

/**
 * IndexNow (https://www.indexnow.org): after a deploy, tell Bing, Yandex and
 * the other participating engines which URLs to recrawl. The key is public by
 * design; `public/<key>.txt` proves we own the host.
 */
export const INDEXNOW_KEY = "ff61d85b3111b2b8363d64994240d005";

export const INDEXNOW_ENDPOINT = "https://api.indexnow.org/indexnow";

/** Protocol limit per POST. */
const MAX_URLS_PER_REQUEST = 10_000;

const keyLocation = `${SITE_ORIGIN}/${INDEXNOW_KEY}.txt`;

type Fetch = typeof fetch;

export interface IndexNowRuntime {
  fetch: Fetch;
  sleep: (ms: number) => Promise<void>;
  /** Tries for the live key file and sitemap before giving up. */
  attempts: number;
  delayMs: number;
}

export type IndexNowOutcome =
  | { kind: "submitted"; httpStatus: number; urlCount: number }
  | { kind: "skipped"; reason: string };

const XML_ENTITIES = new Map([
  ["&amp;", "&"],
  ["&lt;", "<"],
  ["&gt;", ">"],
  ["&quot;", '"'],
  ["&apos;", "'"],
]);

/** `<loc>` URLs from a sitemap on our own origin, deduped, in document order. */
export function sitemapUrls(xml: string): string[] {
  const urls = [...xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/g)].map((match) =>
    match[1].replace(/&(?:amp|lt|gt|quot|apos);/g, (entity) => XML_ENTITIES.get(entity) ?? entity),
  );

  return [...new Set(urls.filter((url) => url.startsWith(`${SITE_ORIGIN}/`)))];
}

export function indexNowBody(urls: readonly string[]): string {
  return JSON.stringify({
    host: new URL(SITE_ORIGIN).host,
    key: INDEXNOW_KEY,
    keyLocation,
    urlList: urls.slice(0, MAX_URLS_PER_REQUEST),
  });
}

async function fetchText(runtime: IndexNowRuntime, url: string): Promise<string | null> {
  try {
    const response = await runtime.fetch(url, { headers: { "Cache-Control": "no-cache" } });

    return response.ok ? await response.text() : null;
  } catch {
    return null;
  }
}

/**
 * Retries `read` until it yields a value. The first deploy with a new key only
 * serves the key file once the new version is live, so this also waits out
 * propagation right after `wrangler deploy`.
 */
async function poll<T>(runtime: IndexNowRuntime, read: () => Promise<T | null>): Promise<T | null> {
  for (let attempt = 1; attempt <= runtime.attempts; attempt++) {
    const value = await read();

    if (value !== null) return value;

    if (attempt < runtime.attempts) await runtime.sleep(runtime.delayMs);
  }

  return null;
}

/**
 * Submits every URL in the live sitemap. Never throws: a failed ping must not
 * fail a deploy that already shipped, so every failure becomes `skipped`.
 */
export async function submitSitemapToIndexNow(runtime: IndexNowRuntime): Promise<IndexNowOutcome> {
  const liveKey = await poll(runtime, async () => {
    const text = await fetchText(runtime, keyLocation);

    return text?.trim() === INDEXNOW_KEY ? text : null;
  });

  if (liveKey === null) return { kind: "skipped", reason: `key file not live at ${keyLocation}` };

  const urls = await poll(runtime, async () => {
    const xml = await fetchText(runtime, `${SITE_ORIGIN}/sitemap.xml`);
    const found = xml === null ? [] : sitemapUrls(xml);

    return found.length > 0 ? found : null;
  });

  if (urls === null) return { kind: "skipped", reason: "sitemap unavailable or empty" };

  try {
    const response = await runtime.fetch(INDEXNOW_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: indexNowBody(urls),
    });

    // 200 = accepted, 202 = accepted while the engine still validates the key.
    if (response.status === 200 || response.status === 202) {
      return { kind: "submitted", httpStatus: response.status, urlCount: urls.length };
    }

    const detail = (await response.text()).slice(0, 200);

    return { kind: "skipped", reason: `IndexNow answered ${response.status}: ${detail}` };
  } catch (error) {
    return {
      kind: "skipped",
      reason: `IndexNow request failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
