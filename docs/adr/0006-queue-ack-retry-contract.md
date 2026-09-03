# Queue ack/retry verdict lives in processSection, one transport

The production queue consumer is `worker.ts queue()`, which calls `processSection()` **directly** (no internal HTTP). The former `app/api/queue/process-section/route.ts` HTTP mirror was deleted (#380 Phase 1) — tests exercise `processSection()` directly. Decision table lives inside `processSection` (returns `SectionCheckOutcome`); the worker translates `disposition` to transport (queue ack/retry). Previously derived from the single pure `classifyDisposition` in `lib/queue/disposition.ts` (since folded into `processSection`).

## Why

One entry point (direct worker call) owns the retry verdict. Centralizing the verdict in `processSection` means no second transport can silently disagree — the worker only **translates** the `Disposition` (`'ack' | 'retry'`) to queue ack/retry, with no hand-policed "keep these identical" comment.

## Consequences

- **Transport translation:** consumer maps `ack→message.ack()`, `retry→message.retry()`.
- The decision table (now inside `lib/queue/process-section.ts`, returns `SectionCheckOutcome`): success ⇒ `ack` (200); `{success:false}` (DB upsert error) ⇒ `retry` (500); `AuthError`/`NotFoundError` ⇒ `ack` (200, retryable:false); `RateLimitError` ⇒ `retry` (429); `ApiError` ⇒ `retry` (502); unknown ⇒ `retry` (500, defensive).
- `README.md`/`CONTEXT.md` historically claimed the consumer uses **internal HTTP**; corrected to the direct `processSection()` call. Watch for that phrasing creeping back in.
