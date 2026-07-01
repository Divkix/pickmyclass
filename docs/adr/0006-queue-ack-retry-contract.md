# Queue ack/retry verdict is one pure decision table, two transports

The production queue consumer is `worker.ts queue()`, which calls `processSection()` **directly** (no internal HTTP). `app/api/queue/process-section/route.ts` is a deliberately maintained **mirror** for HTTP-dispatched processing / tests. Both derive their ack/retry verdict from the single pure `classifyDisposition` in `lib/queue/disposition.ts`.

## Why

Two entry points (direct worker call + HTTP route) risk drifting in their retry logic. Centralizing the verdict in one pure function means neither can silently disagree — each only **translates** the `Disposition` (`'ack' | 'retry'`) to its own transport, with no hand-policed "keep these identical" comment.

## Consequences

- **Transport translation:** consumer maps `ack→message.ack()`, `retry→message.retry()`; the HTTP route maps `ack→200`, `retry→429/502` plus a top-level `retryable` boolean.
- The HTTP route returns **`200` for an `ack` verdict on purpose** — returning 4xx/5xx for `ack` would cause infinite retries.
- The decision table (`lib/queue/disposition.ts`): success ⇒ `ack`; `{success:false}` (DB upsert error) ⇒ `retry`; `AuthError`/`NotFoundError` ⇒ `ack` (bad token / section gone); `RateLimitError`/`ApiError` ⇒ `retry`; unknown thrown ⇒ `retry` (defensive).
- `README.md`/`CONTEXT.md` historically claimed the consumer uses **internal HTTP**; corrected to the direct `processSection()` call. Watch for that phrasing creeping back in.
