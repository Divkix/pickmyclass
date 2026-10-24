/**
 * Typed failures of a database call. Both extend `Error`, so they keep flowing
 * through the existing `catch` blocks, and `DbQueryFailed` carries the
 * SQLSTATE in `code` so `getPgError` and `isUniqueViolation` still read it
 * through Drizzle's statement wrapper.
 *
 * `retryable` is the decision for the layer that owns retries (the queue
 * consumer, a Workflow step): connection and contention failures are worth
 * another attempt, a constraint or syntax error never is.
 *
 * @module lib/db/errors
 */
import { Data } from "effect";

/** The server or the connection rejected the statement. */
export class DbQueryFailed extends Data.TaggedError("DbQueryFailed")<{
  message: string;
  operation: string;
  /** SQLSTATE when the server sent one; absent for a dropped connection. */
  code?: string;
  retryable: boolean;
  cause: Error;
}> {}

/**
 * Gave up waiting. The statement may still commit on the server, so a retry
 * must be safe to repeat (every pipeline write is conditional or idempotent).
 */
export class DbQueryTimedOut extends Data.TaggedError("DbQueryTimedOut")<{
  message: string;
  operation: string;
  timeoutMs: number;
  retryable: true;
}> {}
