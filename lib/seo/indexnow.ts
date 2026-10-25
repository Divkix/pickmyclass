import { INDEXNOW_TIMEOUT_MS } from "@/lib/config";
import { Effect } from "effect";
import { externalCall } from "@/lib/effect/external-call";
import { IndexNowRequestFailed, IndexNowRequestTimedOut } from "@/lib/seo/errors";
import { SITE_ORIGIN } from "@/lib/seo/public-pages";

/**
 * IndexNow (https://www.indexnow.org): after a deploy, tell Bing, Yandex and
 * the other participating engines which URLs to recrawl. The key is public by
 * design; `public/<key>.txt` proves we own the host.
 * When `INDEXNOW_KEY` changes, rename `public/<key>.txt` and replace its contents with the new key;
 * a mismatch prevents the engines from verifying ownership.
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
  /** Per request, body included; defaults to `INDEXNOW_TIMEOUT_MS`. */
  timeoutMs?: number;
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
function sitemapUrls(xml: string): string[] {
  const urls = [...xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/g)].map((match) =>
    match[1].replace(/&(?:amp|lt|gt|quot|apos);/g, (entity) => XML_ENTITIES.get(entity) ?? entity),
  );

  return [...new Set(urls.filter((url) => url.startsWith(`${SITE_ORIGIN}/`)))];
}

function indexNowBody(urls: readonly string[]): string {
  return JSON.stringify({
    host: new URL(SITE_ORIGIN).host,
    key: INDEXNOW_KEY,
    keyLocation,
    urlList: urls.slice(0, MAX_URLS_PER_REQUEST),
  });
}

interface IndexNowReply {
  status: number;
  ok: boolean;
  text: string;
}

/** The status and body of one request, or a typed failure (`IndexNowRequestFailed`/`TimedOut`). */
function request(runtime: IndexNowRuntime, url: string, init: RequestInit): Promise<IndexNowReply> {
  const timeoutMs = runtime.timeoutMs ?? INDEXNOW_TIMEOUT_MS;

  return Effect.runPromise(
    externalCall(
      async (signal) => {
        const response = await runtime.fetch(url, { ...init, signal });

        return { status: response.status, ok: response.ok, text: await response.text() };
      },
      timeoutMs,
      (error) => new IndexNowRequestFailed({ message: error.message, url, cause: error }),
      () =>
        new IndexNowRequestTimedOut({
          message: `IndexNow request to ${url} timed out after ${timeoutMs}ms`,
          url,
          timeoutMs,
        }),
    ),
  );
}

/** A read that yields a value, or says why it did not. */
type Poll<T> = { value: T } | { value: null; why: string };

async function fetchText(runtime: IndexNowRuntime, url: string): Promise<Poll<string>> {
  try {
    const reply = await request(runtime, url, { headers: { "Cache-Control": "no-cache" } });

    return reply.ok
      ? { value: reply.text }
      : { value: null, why: `${url} answered ${reply.status}` };
  } catch (error) {
    return { value: null, why: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Retries `read` until it yields a value, returning why the last attempt came
 * up empty. The first deploy with a new key only serves the key file once the
 * new version is live, so this also waits out propagation right after
 * `wrangler deploy`.
 */
async function poll<T>(runtime: IndexNowRuntime, read: () => Promise<Poll<T>>): Promise<Poll<T>> {
  let last: Poll<T> = { value: null, why: "no attempts" };

  for (let attempt = 1; attempt <= runtime.attempts; attempt++) {
    last = await read();

    if (last.value !== null) return last;

    if (attempt < runtime.attempts) await runtime.sleep(runtime.delayMs);
  }

  return last;
}

/**
 * Submits every URL in the live sitemap. Never throws: a failed ping must not
 * fail a deploy that already shipped, so every failure becomes `skipped`.
 */
export async function submitSitemapToIndexNow(runtime: IndexNowRuntime): Promise<IndexNowOutcome> {
  const liveKey = await poll(runtime, async () => {
    const read = await fetchText(runtime, keyLocation);

    if (read.value === null) return read;

    return read.value.trim() === INDEXNOW_KEY
      ? read
      : { value: null, why: `${keyLocation} does not hold the key` };
  });

  if (liveKey.value === null) {
    return { kind: "skipped", reason: `key file not live at ${keyLocation}: ${liveKey.why}` };
  }

  const urls = await poll(runtime, async (): Promise<Poll<string[]>> => {
    const read = await fetchText(runtime, `${SITE_ORIGIN}/sitemap.xml`);

    if (read.value === null) return read;

    const found = sitemapUrls(read.value);

    return found.length > 0 ? { value: found } : { value: null, why: "sitemap lists no URLs" };
  });

  if (urls.value === null) return { kind: "skipped", reason: `sitemap unavailable: ${urls.why}` };

  try {
    const reply = await request(runtime, INDEXNOW_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: indexNowBody(urls.value),
    });

    // 200 = accepted, 202 = accepted while the engine still validates the key.
    if (reply.status === 200 || reply.status === 202) {
      return { kind: "submitted", httpStatus: reply.status, urlCount: urls.value.length };
    }

    return {
      kind: "skipped",
      reason: `IndexNow answered ${reply.status}: ${reply.text.slice(0, 200)}`,
    };
  } catch (error) {
    return {
      kind: "skipped",
      reason: `IndexNow request failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
