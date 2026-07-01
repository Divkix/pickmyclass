# Notification dedup via a partial unique index + daily expiry sweep

`notifications_sent` deduplicates emails using a **partial unique index `unique_notification_active WHERE is_active=TRUE`**, paired with `try_record_notifications_batch` (atomic claim) and a **daily 4 AM `expire_stale_notifications()` RPC** that frees expired slots.

## Why

- A plain `UNIQUE` constraint **blocked re-insertion after expiry** (issue #157) — once a row existed, a user could never be re-notified for the same section.
- `is_active` is a **boolean**, not a timestamp comparison, because partial-index predicates **can't use volatile `NOW()`**. So expiry can't be expressed in the index; something must flip the flag.
- Rows expire after 24h but **nothing flips `is_active=FALSE` automatically** — the daily sweep is the only mechanism that does.

## Consequences

- The **daily `expire_stale_notifications()` cron is load-bearing**: if it stops, users never get re-notified after the 24h window. It also hard-deletes past-term watches (`getPastTermCodes` → `delete class_watches`).
- The claim is authoritative: email **exactly the watch IDs returned by `try_record_notifications_batch`** (the newly-claimed set), and **roll back failed sends** via `deleteNotificationRecords`, or those users are suppressed for 24h.
- `README.md`/`CONTEXT.md` historically described this as generic "atomic `INSERT...ON CONFLICT`"; corrected to the real mechanism (the `is_active` partial unique index + `try_record_notifications_batch` + the daily expiry sweep). Watch for the oversimplified framing creeping back in.
