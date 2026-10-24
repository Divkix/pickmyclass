/**
 * The only place that calls the `send_email` binding. Every send gets an
 * explicit timeout and fails with `EmailSendFailed` or `EmailTimedOut`; the
 * binding's thrown value is validated before its code is trusted.
 *
 * @module lib/email/transport
 */
import { Effect } from "effect";
import { z } from "zod";
import { EMAIL_SEND_TIMEOUT_MS } from "@/lib/config";
import { EmailSendFailed, EmailTimedOut, isRetryableEmailCode } from "@/lib/email/errors";
import { externalCall } from "@/lib/effect/external-call";

const bindingFailureSchema = z.object({
  code: z.string().optional(),
  message: z.string().optional(),
});

export function sendEmailMessage(
  binding: SendEmail,
  message: EmailMessageBuilder,
  timeoutMs = EMAIL_SEND_TIMEOUT_MS,
): Promise<EmailSendResult> {
  return Effect.runPromise(
    externalCall(
      () => binding.send(message),
      timeoutMs,
      (error) => {
        const parsed = bindingFailureSchema.safeParse(error);
        const code = (parsed.success && parsed.data.code) || "UNKNOWN";

        return new EmailSendFailed({
          message: (parsed.success && parsed.data.message) || "Email send failed",
          code,
          retryable: isRetryableEmailCode(code),
          cause: error,
        });
      },
      () =>
        new EmailTimedOut({
          message: `Email send timed out after ${timeoutMs}ms`,
          timeoutMs,
        }),
    ),
  );
}
