/**
 * Reads the retry decision a typed external-call failure carries. Failures
 * with `retryable: false` (a constraint violation, a rejected payload) fail the
 * same way every time, so the layer that owns retries should give up on them.
 *
 * @module lib/effect/failure
 */
export function isPermanentFailure(error: Error): boolean {
  return "retryable" in error && error.retryable === false;
}
