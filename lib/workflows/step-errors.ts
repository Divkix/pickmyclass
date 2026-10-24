/**
 * Lets a Workflow step stop its own retries on a failure that cannot succeed.
 * Everything else rethrows untouched so `retries` in the step config still
 * applies to transient failures.
 *
 * @module lib/workflows/step-errors
 */
import { NonRetryableError } from "cloudflare:workflows";
import { isPermanentFailure } from "@/lib/effect/failure";

export async function failPermanently<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof Error && isPermanentFailure(error))
      throw new NonRetryableError(error.message, error.name);

    throw error;
  }
}
