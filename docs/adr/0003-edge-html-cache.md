# Worker edge HTML cache for anonymous public pages

> **Superseded by [0009-edge-html-cache-rsc-exclusion](./0009-edge-html-cache-rsc-exclusion.md)** — the cache now excludes RSC requests and stores only `text/html`. The rationale below still applies.

`lib/worker/edge-html-cache.ts` owns an **edge HTML cache** (Cache API `caches.default`) for anonymous GETs to `/`, `/faq`, `/about`, `/blog`, `/blog/*`, `/legal`, `/legal/*`; `worker.ts fetch()` is its vinext/Cloudflare adapter. A HIT skips `proxy.ts` **and** the RSC render entirely. It is the outermost of three cache layers (this HTML cache, `public/_headers` for static assets, and the Cloudflare edge).

## Why

`GET /` was **~58% of worker CPU** at ~33ms/render, and it's the **only** thing setting `Cache-Control` on HTML (`public/_headers` deliberately does not). Skipping the render on the hottest anonymous path is the single biggest CPU saver.

## Consequences

- **Cache key = pathname-only + deploy version id.** Query string is ignored (so `?utm=`/`?x=N` can't flood the cache); the key includes `env.CF_VERSION_METADATA.id` (from the `version_metadata` binding) so every deploy auto-busts entries — cached HTML references hashed `/_next/static` chunks that change per deploy.
- **Only anonymous, 200, no-`Set-Cookie` responses are stored** (`!hasSupabaseAuthCookiesInHeader`). Logged-in users always get a fresh render.
- **Accepted trade-off — frozen CSP nonce.** The per-request CSP nonce is frozen-but-internally-consistent per cache entry (cached CSP header nonce matches cached body script nonces), reused for the entry's lifetime. Acceptable only because these are public pages with no user content.
- `EDGE_HTML_CACHE_TTL_S` (1h) bounds staleness within a deploy.
