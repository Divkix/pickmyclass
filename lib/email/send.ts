import { z } from "zod";
import { Data, Effect, Result } from "effect";
import { InstructorAssignedEmailTemplate, SeatAvailableEmailTemplate } from "./templates";
import type { ClassInfo } from "@/lib/types/class";
import { EMAIL_BATCH_DELAY_MS, EMAIL_BATCH_SIZE, NOTIFICATION_FROM_EMAIL } from "@/lib/config";
import { log } from "@/lib/log";
import type { NotificationType } from "@/lib/types/notification";
import { generateUnsubscribeUrl } from "./unsubscribe-token";

export type { ClassInfo } from "@/lib/types/class";

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

interface EmailResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

interface SendBatchEmailOptions {
  fromEmail?: string;
  onSending?: (index: number) => void;
  onResult?: (index: number, result: EmailResult) => Promise<void>;
}

export interface OutboundEmail {
  to: string;
  userId: string;
  classInfo: ClassInfo;
  type: NotificationType;
}

const emailFailureSchema = z.object({
  code: z.string().optional(),
  message: z.string().optional(),
});

class EmailFailure extends Data.TaggedError("EmailFailure")<{ code: string; message: string }> {}

class EmailFatal extends Data.TaggedError("EmailFatal")<{ code: string; index: number }> {}

export function isFatalEmailCode(code: string): boolean {
  return (
    code === "E_RATE_LIMIT_EXCEEDED" ||
    code === "E_DAILY_LIMIT_EXCEEDED" ||
    code === "E_SENDER_NOT_VERIFIED"
  );
}

/** Sequential sends with a pause only between full batches. */
export function sendBatchEmailsEffect(
  emails: OutboundEmail[],
  emailBinding: SendEmail,
  options: SendBatchEmailOptions = {},
): Effect.Effect<EmailResult[]> {
  return Effect.gen(function* () {
    const results: EmailResult[] = [];
    yield* Effect.forEach(
      emails,
      (email, index) =>
        Effect.gen(function* () {
          if (index > 0 && index % EMAIL_BATCH_SIZE === 0)
            yield* Effect.sleep(EMAIL_BATCH_DELAY_MS);
          const unsubscribeUrl = generateUnsubscribeUrl(email.userId);
          const isSeat = email.type === "seat_available";

          const html = isSeat
            ? SeatAvailableEmailTemplate(email.classInfo, unsubscribeUrl)
            : InstructorAssignedEmailTemplate(email.classInfo, unsubscribeUrl);

          options.onSending?.(index);

          const attempt = yield* Effect.tryPromise({
            try: () =>
              emailBinding.send({
                to: email.to,
                from: options.fromEmail || NOTIFICATION_FROM_EMAIL,
                subject: isSeat
                  ? `🎉 Seat Available: ${email.classInfo.subject} ${email.classInfo.catalog_nbr} (${email.classInfo.class_nbr})`
                  : `👨‍🏫 Instructor Assigned: ${email.classInfo.subject} ${email.classInfo.catalog_nbr} (${email.classInfo.class_nbr})`,
                html,
                text: stripHtml(html),
                headers: {
                  "List-Unsubscribe": `<${unsubscribeUrl}>`,
                  "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
                },
              }),
            catch: (error) => {
              const parsed = emailFailureSchema.safeParse(error);

              return new EmailFailure({
                code: parsed.success ? parsed.data.code || "UNKNOWN" : "UNKNOWN",
                message: parsed.success
                  ? parsed.data.message || "Email send failed"
                  : "Email send failed",
              });
            },
          }).pipe(Effect.result);

          const result: EmailResult = Result.isSuccess(attempt)
            ? { success: true, messageId: attempt.success.messageId }
            : { success: false, error: `${attempt.failure.code}: ${attempt.failure.message}` };

          results.push(result);
          const onResult = options.onResult;

          if (onResult) yield* Effect.promise(() => onResult(index, result));

          if (Result.isFailure(attempt)) {
            log("Email").error(
              `Failed to send to ${email.to}: ${attempt.failure.code} - ${attempt.failure.message}`,
            );

            if (isFatalEmailCode(attempt.failure.code))
              return yield* new EmailFatal({ code: attempt.failure.code, index });
          }
        }),
      { concurrency: 1, discard: true },
    ).pipe(
      Effect.catchTags({
        EmailFatal: (error) =>
          Effect.sync(() => {
            for (let i = error.index + 1; i < emails.length; i++)
              results.push({ success: false, error: `Skipped: ${error.code} limit reached` });
            log("Email").warn(
              `Stopped batch after ${error.code} at email ${error.index + 1}/${emails.length}`,
            );
          }),
      }),
    );

    if (emails.length > 0)
      log("Email").info(
        `Batch complete: ${results.filter((r) => r.success).length}/${emails.length} sent successfully`,
      );

    return results;
  });
}

export function sendBatchEmailsOptimized(
  emails: OutboundEmail[],
  emailBinding: SendEmail,
  options: SendBatchEmailOptions = {},
): Promise<EmailResult[]> {
  return Effect.runPromise(sendBatchEmailsEffect(emails, emailBinding, options));
}
