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
 * Cloudflare documents no retry guidance, so each code answers two questions
 * from its description. Retryable: may this send succeed later? Rate, quota and
 * server errors are temporary; every other code is a permanent payload or
 * configuration problem, and a recipient server's rejection is not retried
 * blindly. Batch-fatal: will every following send in the batch fail the same
 * way? Account- and sender-wide blocks stop the batch; a server error does not.
 * https://developers.cloudflare.com/email-service/api/send-emails/workers-api/
 */
const RETRYABLE_EMAIL_CODES = {
  E_RATE_LIMIT_EXCEEDED: true,
  E_DAILY_LIMIT_EXCEEDED: true,
  E_INTERNAL_SERVER_ERROR: true,
} satisfies Record<string, true>;

const BATCH_FATAL_EMAIL_CODES = {
  E_RATE_LIMIT_EXCEEDED: true,
  E_DAILY_LIMIT_EXCEEDED: true,
  E_SENDER_NOT_VERIFIED: true,
  E_SENDER_DOMAIN_NOT_AVAILABLE: true,
  E_ACCOUNT_SUSPENDED: true,
} satisfies Record<string, true>;

/** An unrecognised failure (network, runtime) is treated as transient. */
export function isRetryableEmailCode(code: string): boolean {
  return code === "UNKNOWN" || Object.hasOwn(RETRYABLE_EMAIL_CODES, code);
}

/** Every following send in the batch would fail the same way, so the batch stops. */
export function isFatalEmailCode(code: string): boolean {
  return Object.hasOwn(BATCH_FATAL_EMAIL_CODES, code);
}
