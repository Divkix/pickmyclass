import { InstructorAssignedEmailTemplate, SeatAvailableEmailTemplate } from "./templates";
import type { ClassInfo } from "@/lib/types/class";
import { EMAIL_BATCH_DELAY_MS, EMAIL_BATCH_SIZE, NOTIFICATION_FROM_EMAIL } from "@/lib/config";
import { type ErrorFields, errorFields, log, logEvent } from "@/lib/log";
import type { NotificationType } from "@/lib/types/notification";
import { sectionFields } from "@/lib/section-ref";
import { withSpan } from "@/lib/telemetry/span";
import { generateUnsubscribeUrl } from "./unsubscribe-token";
import { EmailSendFailed, EmailTimedOut, isFatalEmailCode } from "./errors";
import { sendEmailMessage } from "./transport";

export type { ClassInfo } from "@/lib/types/class";

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export interface EmailResult {
  success: boolean;
  messageId?: string;
  error?: string;
  code?: string;
  retryable?: boolean;
  cause?: Error;
  /** The send timed out: the provider may still deliver, so never treat it as not sent. */
  outcomeUnknown?: boolean;
}

interface SendBatchEmailOptions {
  fromEmail?: string;
  onSending?: (index: number) => void;
  onResult?: (index: number, result: EmailResult) => void | Promise<void>;
}

export interface OutboundEmail {
  to: string;
  userId: string;
  classInfo: ClassInfo;
  type: NotificationType;
}

interface EmailFailure {
  code: string;
  message: string;
  fields: ErrorFields;
  outcomeUnknown: boolean;
  retryable: boolean;
  cause: Error;
}

function describeFailure(error: Error): EmailFailure {
  const fields = errorFields(error);

  if (error instanceof EmailTimedOut)
    return {
      code: "TIMEOUT",
      message: error.message,
      fields,
      outcomeUnknown: true,
      retryable: true,
      cause: error,
    };

  if (error instanceof EmailSendFailed)
    return {
      code: error.code,
      message: error.message,
      fields,
      outcomeUnknown: false,
      retryable: error.retryable,
      cause: error,
    };

  return {
    code: "UNKNOWN",
    message: "Email send failed",
    fields,
    outcomeUnknown: false,
    retryable: true,
    cause: error,
  };
}

/** Sequential sends with a pause only between full batches. */
export async function sendBatchEmailsOptimized(
  emails: OutboundEmail[],
  emailBinding: SendEmail,
  options: SendBatchEmailOptions = {},
): Promise<EmailResult[]> {
  const startTime = Date.now();
  const results: EmailResult[] = [];
  // Emails after a fatal provider error, never attempted.
  let skipped = 0;

  for (const [index, email] of emails.entries()) {
    if (index > 0 && index % EMAIL_BATCH_SIZE === 0)
      await new Promise((resolve) => setTimeout(resolve, EMAIL_BATCH_DELAY_MS));
    const unsubscribeUrl = generateUnsubscribeUrl(email.userId);
    const isSeat = email.type === "seat_available";

    const html = isSeat
      ? SeatAvailableEmailTemplate(email.classInfo, unsubscribeUrl)
      : InstructorAssignedEmailTemplate(email.classInfo, unsubscribeUrl);

    options.onSending?.(index);
    let messageId: string | undefined;
    let failure: EmailFailure | undefined;

    try {
      // The send_email binding gets no runtime span; this one never names the recipient.
      ({ messageId } = await withSpan(
        "email.send",
        { notification_type: email.type, ...sectionFields(email.classInfo) },
        () =>
          sendEmailMessage(emailBinding, {
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
      ));
    } catch (error) {
      // sendEmailMessage only rejects with its own typed failures.
      failure = describeFailure(error instanceof Error ? error : new Error(String(error)));
    }

    const result: EmailResult = failure
      ? {
          success: false,
          error: `${failure.code}: ${failure.message}`,
          code: failure.code,
          retryable: failure.retryable,
          cause: failure.cause,
          ...(failure.outcomeUnknown && { outcomeUnknown: true }),
        }
      : { success: true, messageId };

    results.push(result);
    await options.onResult?.(index, result);

    if (!failure) continue;
    log("Email").error("Email send failed", {
      user_id: email.userId,
      notification_type: email.type,
      ...sectionFields(email.classInfo),
      // Normalised provider code (UNKNOWN when absent), which the fatal check keys on.
      "email.code": failure.code,
      ...failure.fields,
    });

    if (isFatalEmailCode(failure.code)) {
      skipped = emails.length - index - 1;

      for (let i = index + 1; i < emails.length; i++)
        results.push({
          success: false,
          error: `Skipped after ${failure.code}`,
          code: failure.code,
          retryable: failure.retryable,
          cause: failure.cause,
        });
      log("Email").warn("Stopped email batch on fatal provider error", {
        "email.code": failure.code,
        position: index + 1,
        total: emails.length,
      });
      break;
    }
  }

  if (emails.length > 0) {
    const sent = results.filter((r) => r.success).length;
    const unknownOutcome = results.filter((r) => r.outcomeUnknown).length;

    logEvent("email_batch_sent", {
      sent,
      failed: emails.length - sent - unknownOutcome - skipped,
      unknown_outcome: unknownOutcome,
      skipped,
      duration_ms: Date.now() - startTime,
    });
  }

  return results;
}
