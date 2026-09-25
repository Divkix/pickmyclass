# Cron jobs run as Workflow schedules, not a Worker cron + lock

**Date:** 2026-09-24. **Status:** Accepted. Supersedes `0011-cron-lock-lifecycle-boundary.md`.

## Context

The 30-minute section check and the 04:05 maintenance sweep ran as Worker cron triggers: `scheduled()` built a fake HTTP request to `/api/cron` (or `/api/cron/maintenance`) authenticated with `CRON_SECRET`, and the routes took a `CronLockDO` lease (25-minute auto-expiry) before doing work. Cron has no retries, so a failed enqueue was only logged (`CRON_PARTIAL_FAILURE`, HTTP 207). The DLQ consumer logged and acked, discarding the evidence.

## Decision

- **`SectionCheckWorkflow` and `MaintenanceWorkflow`** (`lib/workflows/cron-workflows.ts`) are started by `schedules` on their `wrangler.jsonc` Workflow bindings (`0,30 * * * *`, `5 4 * * *`). No `scheduled()` handler, no `/api/cron*` routes, no `triggers.crons` (kept as `[]` so deploys clear the old triggers).
- **Each unit of work is a `step.do`** with 5 exponential retries (10s base, 2-minute timeout): expire stale notifications, load sections, and one step per `sendBatch` of 100. A batch that fails after its retries errors the instance *after* the other batches have been enqueued, so a run is visible as failed in the Workflows dashboard.
- **The stale-notification sweep is best-effort in the section check** (caught and logged) but a hard step in maintenance. Maintenance's two steps run independently; either failing errors the instance.
- **No lock.** Duplicate or overlapping instances are safe: every message carries the `cycle` stamp (`<scheduledTime ISO>:<stagger>`) that `processSection` uses to skip an already-checked section, and the conditional `class_states` upsert rejects stale writes. Stagger and cycle come from `event.schedule.scheduledTime` (the trigger time for a manual `wrangler workflows trigger`).
- **The DLQ has no consumer.** Exhausted messages stay in `pickmyclass-dlq` to inspect or redrive (24h retention on Workers Free). The next cycle enqueues a fresh check anyway.
- **ASU 429 retries back off** via `message.retry({ delaySeconds })`: 60s doubling per attempt, honouring a longer `Retry-After`, capped at 15 minutes so the retry lands before the section's next cycle. Other retries use the consumer's `retry_delay`.

## Consequences

- `CronLockDO` is deleted by migration `v3` (`deleted_classes`). Health no longer reports a cron lock; run history lives in the Workflows dashboard (3 days on Free, 30 on Paid).
- Workers Free limits that matter: 10 ms CPU per step, 1,024 steps per instance (~100k sections at 100 per batch), 100 concurrent instances.
- `CRON_SECRET` now only gates the detailed `/api/monitoring/health` response.
