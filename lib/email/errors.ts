/**
 * Typed failures of a `send_email` binding call. Both extend `Error`, so they
 * flow through existing `catch` blocks.
 *
 * `EmailSendFailed` means the provider answered no: nothing was sent, so the
 * caller may release its claim. `EmailTimedOut` means we stopped waiting: the
 * provider may still deliver, so the caller must keep the claim in flight.
 *
 * @module lib/email/errors
 */
import { Data } from "effect";

export class EmailSendFailed extends Data.TaggedError("EmailSendFailed")<{
  message: string;
  /** Provider code (`E_*`), or `UNKNOWN` when the binding threw something else. */
  code: string;
  /** Worth another attempt later; permanent payload or configuration errors are not. */
  retryable: boolean;
  cause: Error;
}> {}

export class EmailTimedOut extends Data.TaggedError("EmailTimedOut")<{
  message: string;
  timeoutMs: number;
}> {}

/**
 * Cloudflare documents no retry guidance. Rate, quota and server errors are
 * temporary by their descriptions; every other documented code is a permanent
 * payload or configuration problem. A delivery rejection from the recipient's
 * server is not retried blindly.
 * https://developers.cloudflare.com/email-service/api/send-emails/workers-api/
 */
const RETRYABLE_EMAIL_CODES = new Set([
  "E_RATE_LIMIT_EXCEEDED",
  "E_DAILY_LIMIT_EXCEEDED",
  "E_INTERNAL_SERVER_ERROR",
]);

/** An unrecognised failure (network, runtime) is treated as transient. */
export function isRetryableEmailCode(code: string): boolean {
  return code === "UNKNOWN" || RETRYABLE_EMAIL_CODES.has(code);
}
