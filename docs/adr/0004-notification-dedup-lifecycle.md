# Notification dedup via a partial unique index + expiry sweep

`notifications_sent` deduplicates emails using a **partial unique index `unique_notification_active WHERE is_active=TRUE`**, paired with `try_record_notifications_batch` (atomic claim), `reset_section_notifications` (join-scoped single-statement reset), `delete_notification_records_by_ids` (row-id rollback), and an **`expire_stale_notifications()` sweep on every 30-min cron tail plus the 04:05 maintenance run** that frees expired slots.

## Why

- A plain `UNIQUE` constraint **blocked re-insertion after expiry** (issue #157) — once a row existed, a user could never be re-notified for the same section.
- `is_active` is a **boolean**, not a timestamp comparison, because partial-index predicates **can't use volatile `NOW()`**. So expiry can't be expressed in the index; something must flip the flag.
- Rows expire after 24h but **nothing flips `is_active=FALSE` automatically** — the daily sweep is the only mechanism that does.

## Consequences

- The **`expire_stale_notifications()` sweep is load-bearing**: it runs best-effort at the start of every `SectionCheckWorkflow` run and again in the 04:05 `MaintenanceWorkflow` run (which also hard-deletes past-term watches via `getPastTermCodes` → `delete class_watches`). If both stop, users never get re-notified after the 24h window. The claim predicate is `is_active = TRUE` (matching the index); FK-vanished watches are skipped, not errors.
- The claim is authoritative: email **exactly the watch IDs returned by `try_record_notifications_batch`** (the newly-claimed set), and **roll back failed sends** with the notification row ids returned by that same call (`deleteNotificationRecordsByIds`). A later lookup of the active row, or a `(watch,type)` delete, erases a newer claim.
- `README.md`/`CONTEXT.md` historically described this as generic "atomic `INSERT...ON CONFLICT`"; corrected to the real mechanism (the `is_active` partial unique index + `try_record_notifications_batch` + the expiry sweep). Watch for the oversimplified framing creeping back in.
