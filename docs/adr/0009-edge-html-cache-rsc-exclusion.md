# Worker edge HTML cache excludes RSC requests

**Supersedes:** [0003-edge-html-cache](./0003-edge-html-cache.md).

`lib/worker/edge-html-cache.ts` owns an **edge HTML cache** (Cache API `caches.default`) for anonymous GETs to `/`, `/faq`, `/about`, `/blog`, `/blog/*`, `/legal`, `/legal/*`; `worker.ts fetch()` is only its vinext/Cloudflare adapter. A HIT skips `proxy.ts` **and** the RSC render entirely. This ADR keeps everything from 0003 and adds one invariant: **RSC navigation/prefetch requests are never cached or served from the cache, and only `text/html` documents are stored.**

## Why

The cache key (`edgeCacheKey`) is **pathname + deploy version id only** — it deliberately ignores the query string (so `?utm=`/`?x=N` can't flood it) and does not vary on request headers. Next.js App Router, however, fetches the **same URL two ways**:

- a full-document request (`Accept: text/html`) → an HTML page, and
- an **RSC** navigation/prefetch request (`RSC: 1` header, `?_rsc=<hash>` query) → a `text/x-component` **flight** payload.

Because the query string is dropped and the RSC header isn't part of the key, both collapsed onto the same cache entry. An anonymous RSC prefetch of `/` could populate the entry with flight data; the next anonymous full-page load then received that flight payload **as the document**, and the browser rendered the raw RSC stream (`0:…`, `2:I[…]`, `ThemeProvider`, `__layoutIds`, …) as plain text. Classic cache poisoning.

## Decision

In `lib/worker/edge-html-cache.ts`:

- **Exclude RSC requests from cache eligibility** — `request.headers.has('rsc') || url.searchParams.has('_rsc')` ⇒ bypass both the read and the store, always render fresh.
- **Store only `text/html` responses** — a content-type guard (`content-type` includes `text/html`) on the store step, on top of the existing `status === 200 && !Set-Cookie` checks. Defense in depth so a flight payload can never be stored even if the request-side classification changes.

## Consequences

- Everything in 0003 still holds (pathname+version-id key, anonymous/200/no-`Set-Cookie` only, frozen-nonce trade-off, `EDGE_HTML_CACHE_TTL_S` 1h).
- RSC prefetches always cost a render (they are cheap and infrequent relative to full page loads); the hot path — anonymous full-document GETs — still hits the cache.
- **Do not** re-add RSC requests to the cache without also varying the key on the RSC header, or the poisoning returns.
