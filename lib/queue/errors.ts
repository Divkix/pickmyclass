/**
 * Typed failures of a Queue producer call. Both are transient by nature: the
 * enqueue is repeatable because every message carries the Cron Cycle stamp that
 * makes a duplicate Section Check a no-op, so the Workflow step's own retry is
 * the decision-maker.
 *
 * @module lib/queue/errors
 */
import { Data } from "effect";

export class QueueSendFailed extends Data.TaggedError("QueueSendFailed")<{
  message: string;
  retryable: true;
  cause: Error;
}> {}

/** Gave up waiting; the batch may still have been enqueued. */
export class QueueSendTimedOut extends Data.TaggedError("QueueSendTimedOut")<{
  message: string;
  timeoutMs: number;
  retryable: true;
}> {}
