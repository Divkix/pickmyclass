/**
 * Typed failures of a Clerk call. Both extend `Error`, so they flow through
 * existing `catch` blocks.
 *
 * `retryable` follows the Backend API's HTTP status: a 429 or a 5xx may succeed
 * later, any other 4xx will not, and a failure with no status (network) may.
 *
 * @module lib/auth/clerk-errors
 */
import { Data } from "effect";

export class ClerkCallFailed extends Data.TaggedError("ClerkCallFailed")<{
  message: string;
  operation: string;
  /** HTTP status from the Backend API, when Clerk answered. */
  status?: number;
  retryable: boolean;
  cause: Error;
}> {}

export class ClerkCallTimedOut extends Data.TaggedError("ClerkCallTimedOut")<{
  message: string;
  operation: string;
  timeoutMs: number;
  retryable: true;
}> {}

/** Some sessions stayed active after a sign-out-everywhere; the rest were revoked. */
export class SessionRevocationIncomplete extends Data.TaggedError("SessionRevocationIncomplete")<{
  message: string;
  failed: number;
  total: number;
  retryable: true;
}> {}
