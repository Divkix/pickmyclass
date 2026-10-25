/**
 * The one shape every external call takes: a Promise attempt with an explicit
 * timeout and typed failures. Each integration (database, email, queue, Clerk,
 * ...) owns its tagged errors and passes the two constructors in, so a caller
 * can tell "the service said no" from "we gave up waiting".
 *
 * Keep this at external-call leaves, not around orchestration. Retry policy
 * belongs to queue consumers and Workflow steps; never add Effect.retry here
 * beneath those owners.
 *
 * A timeout leaves the outcome unknown: the call may still complete on the
 * other side. Email's policy lives in lib/queue/notification-sender.ts.
 *
 * **Server-only module.** Effect never reaches the browser bundle; a test
 * pins the files the client loads.
 *
 * @module lib/effect/external-call
 */
import { Effect } from "effect";

/**
 * `attempt` gets an `AbortSignal` that fires on timeout or interruption, never
 * after a call that settled in time, so a `fetch` can cancel; attempts that
 * cannot cancel (a driver query) ignore it.
 */
export function externalCall<A, Failed, TimedOut>(
  attempt: (signal: AbortSignal) => Promise<A>,
  timeoutMs: number,
  failed: (error: Error) => Failed,
  timedOut: () => TimedOut,
): Effect.Effect<A, Failed | TimedOut> {
  // tryPromise aborts its signal when interrupted, and the timeout interrupts it.
  return Effect.tryPromise({
    try: attempt,
    catch: (thrown) => failed(thrown instanceof Error ? thrown : new Error(String(thrown))),
  }).pipe(
    Effect.timeoutOrElse({
      duration: timeoutMs,
      orElse: () => Effect.fail(timedOut()),
    }),
  );
}
