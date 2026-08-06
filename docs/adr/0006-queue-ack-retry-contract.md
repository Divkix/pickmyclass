# Queue ack/retry verdict is one pure decision table, two transports

The production queue consumer is `worker.ts queue()`, which calls `processSection()` **directly** (no internal HTTP). `app/api/queue/process-section/route.ts` is a deliberately maintained **mirror** for HTTP-dispatched processing / tests. Decision table now lives inside `processSection` (returns `SectionCheckOutcome`); callers translate `disposition` to transport (queue ack/retry, HTTP 200 vs 429/502). Previously derived from the single pure `classifyDisposition` in `lib/queue/disposition.ts` (since folded into `processSection`).

## Why

Two entry points (direct worker call + HTTP route) risk drifting in their retry logic. Centralizing the verdict in one pure function means neither can silently disagree — each only **translates** the `Disposition` (`'ack' | 'retry'`) to its own transport, with no hand-policed "keep these identical" comment.

## Consequences

- **Transport translation:** consumer maps `ack→message.ack()`, `retry→message.retry()`; the HTTP route maps `ack→200`, `retry→429/502` plus a top-level `retryable` boolean.
- The HTTP route returns **`200` for an `ack` verdict on purpose** — returning 4xx/5xx for `ack` would cause infinite retries.
- The decision table (now inside `lib/queue/process-section.ts`, returns `SectionCheckOutcome`): success ⇒ `ack` (200); `{success:false}` (DB upsert error) ⇒ `retry` (500); `AuthError`/`NotFoundError` ⇒ `ack` (200, retryable:false); `RateLimitError` ⇒ `retry` (429); `ApiError` ⇒ `retry` (502); unknown ⇒ `retry` (500, defensive).
- `README.md`/`CONTEXT.md` historically claimed the consumer uses **internal HTTP**; corrected to the direct `processSection()` call. Watch for that phrasing creeping back in.
