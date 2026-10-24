/**
 * Reads the retry decision a typed external-call failure carries. Failures
 * with `retryable: false` (a constraint violation, a rejected payload) fail the
 * same way every time, so the layer that owns retries should give up on them.
 * The nearest error in the `cause` chain that carries the flag decides.
 *
 * @module lib/effect/failure
 */
import { z } from "zod";

const retryableSchema = z.object({ retryable: z.boolean() });

export function isPermanentFailure(error: Error): boolean {
  let current: unknown = error;

  // Drizzle wraps a failed statement in `DrizzleQueryError`, parking ours on `.cause`.
  for (let depth = 0; depth < MAX_CAUSE_DEPTH && current instanceof Error; depth += 1) {
    const flag = retryableSchema.safeParse(current);

    if (flag.success) return !flag.data.retryable;

    current = current.cause;
  }

  return false;
}

const MAX_CAUSE_DEPTH = 5;
