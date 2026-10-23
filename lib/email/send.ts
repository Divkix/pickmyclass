import { z } from "zod";
import { InstructorAssignedEmailTemplate, SeatAvailableEmailTemplate } from "./templates";
import type { ClassInfo } from "@/lib/types/class";
import { EMAIL_BATCH_DELAY_MS, EMAIL_BATCH_SIZE, NOTIFICATION_FROM_EMAIL } from "@/lib/config";
import { type ErrorFields, errorFields, log } from "@/lib/log";
import type { NotificationType } from "@/lib/types/notification";
import { sectionFields } from "@/lib/section-ref";
import { withSpan } from "@/lib/telemetry/span";
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
  onResult?: (index: number, result: EmailResult) => void | Promise<void>;
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

export function isFatalEmailCode(code: string): boolean {
  return (
    code === "E_RATE_LIMIT_EXCEEDED" ||
    code === "E_DAILY_LIMIT_EXCEEDED" ||
    code === "E_SENDER_NOT_VERIFIED"
  );
}

interface EmailFailure {
  code: string;
  message: string;
  fields: ErrorFields;
}

/** Sequential sends with a pause only between full batches. */
export async function sendBatchEmailsOptimized(
  emails: OutboundEmail[],
  emailBinding: SendEmail,
  options: SendBatchEmailOptions = {},
): Promise<EmailResult[]> {
  const results: EmailResult[] = [];

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
      ));
    } catch (error) {
      const parsed = emailFailureSchema.safeParse(error);

      failure = {
        code: (parsed.success && parsed.data.code) || "UNKNOWN",
        message: (parsed.success && parsed.data.message) || "Email send failed",
        fields: errorFields(error),
      };
    }

    const result: EmailResult = failure
      ? { success: false, error: `${failure.code}: ${failure.message}` }
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
      for (let i = index + 1; i < emails.length; i++)
        results.push({ success: false, error: `Skipped: ${failure.code} limit reached` });
      log("Email").warn("Stopped email batch on fatal provider error", {
        "email.code": failure.code,
        position: index + 1,
        total: emails.length,
      });
      break;
    }
  }

  if (emails.length > 0)
    log("Email").info("Email batch complete", {
      sent: results.filter((r) => r.success).length,
      total: emails.length,
    });

  return results;
}
