# Cron lock lifecycle boundary

`lib/worker/cron-lock.ts` owns the distributed cron lock's lifecycle and client semantics. `CronLockDO` in `worker.ts` remains the Cloudflare adapter: it supplies Durable Object storage, exposes the HTTP dispatcher, and retains the named/default/tree-shaking-guard exports required by Wrangler.

## Decision

- A lock expires after **25 minutes**, leaving a five-minute safety margin before the next 30-minute cron window. The timeout is private to the lifecycle module; callers and tests derive expiry from returned status.
- The holder that acquires a lock is the only holder allowed to release it. Acquire and status operations clear expired or corrupt persisted state before returning.
- `createCronLockClient` hides the singleton DO identity (`pickmyclass-cron-lock`), internal URLs, JSON wire parsing, and acquire/release pairing. It returns a lease whose `release()` targets the acquiring holder.
- A missing `PICKMYCLASS_CRON_LOCK_DO` binding **fails open**: acquire returns an acquired, unconfigured no-op lease so cron processing continues, while health reports `not_configured`.
- A release error is logged and swallowed by the cron route. The lease remains bounded by the lifecycle's 25-minute auto-expiry, so completed work is not converted into a failed cron response.
- The DO class name, `wrangler.jsonc` migration, named export, default export, and `__durableObjectExports` reference are deployment invariants and must remain aligned.

## Consequences

- Cron execution and health monitoring share one interpretation of lock results.
- Lifecycle tests use an in-memory persistence adapter and do not import the full worker or duplicate the timeout.
- New worker-side modules must be listed explicitly in `tsconfig.worker.json`.
