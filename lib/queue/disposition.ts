/**
 * Disposition — the retry-vs-give-up decision for a Section Check.
 *
 * A single message that flows through `processSection` ends one of two ways:
 * it is either **acked** (done — drop it) or **retried** (re-attempt next cycle).
 * That verdict was previously written twice — once as `message.ack()`/`retry()` in
 * the queue consumer (`worker.ts`) and once as HTTP `200`/`429`/`502` in the mirror
 * route — and kept in sync only by a hand-policed comment.
 *
 * This module reifies the decision as one pure function so the two call sites can
 * never disagree. Each site translates the `Disposition` to its own transport;
 * the decision itself lives here.
 */

import { ApiError, AuthError, NotFoundError, RateLimitError } from '@/lib/asu/api';
import type { ProcessingResult } from '@/lib/queue/process-section';

/** The two terminal verdicts for a Section Check message. */
export type Disposition = 'ack' | 'retry';

/**
 * Whether the given value is a `ProcessingResult` (the try-branch outcome) rather
 * than a thrown error. `processSection` returns a plain object with a boolean
 * `success`; thrown ASU errors are `Error` instances, so exclude those.
 */
function isProcessingResult(outcome: unknown): outcome is ProcessingResult {
  return (
    typeof outcome === 'object' &&
    outcome !== null &&
    !(outcome instanceof Error) &&
    typeof (outcome as { success?: unknown }).success === 'boolean'
  );
}

/**
 * Classify the outcome of a Section Check into a single ack/retry verdict.
 *
 * `outcome` is whatever `processSection` produced: a `ProcessingResult` (returned
 * from the try branch) or an unknown thrown error (caught in the catch branch).
 * Both call sites pass their try-result and their caught error through here. The
 * parameter is typed `unknown` because a `ProcessingResult | unknown` union
 * collapses to `unknown` anyway — the two accepted shapes are narrowed internally.
 *
 * Decision table (behavior centralized, unchanged):
 * - success ⇒ `ack`
 * - `{ success: false }` (DB upsert error) ⇒ `retry`
 * - `AuthError` / `NotFoundError` ⇒ `ack` (permanent: bad token / section gone)
 * - `RateLimitError` / `ApiError` ⇒ `retry` (transient upstream)
 * - unknown thrown ⇒ `retry` (defensive)
 */
export function classifyDisposition(outcome: unknown): Disposition {
  // Thrown ASU errors. AuthError and NotFoundError both extend ApiError, so the
  // specific subclasses must be checked before the ApiError base or they'd be
  // misclassified as retryable.
  if (outcome instanceof AuthError || outcome instanceof NotFoundError) {
    return 'ack';
  }
  if (outcome instanceof RateLimitError || outcome instanceof ApiError) {
    return 'retry';
  }

  // Try-branch result: success acks, a DB upsert failure retries.
  if (isProcessingResult(outcome)) {
    return outcome.success ? 'ack' : 'retry';
  }

  // Unknown thrown value — retry defensively.
  return 'retry';
}
