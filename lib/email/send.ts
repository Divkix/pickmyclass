import { InstructorAssignedEmailTemplate, SeatAvailableEmailTemplate } from './templates';
import type { ClassInfo } from '@/lib/types/class';
import { EMAIL_BATCH_DELAY_MS, EMAIL_BATCH_SIZE, NOTIFICATION_FROM_EMAIL } from '@/lib/config';
import { log } from '@/lib/log';
import type { NotificationType } from '@/lib/types/notification';
import { generateUnsubscribeUrl } from './unsubscribe-token';
export type { ClassInfo } from '@/lib/types/class';

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

interface EmailResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

interface SendBatchEmailOptions {
  fromEmail?: string;
}

export interface OutboundEmail {
  to: string;
  userId: string;
  classInfo: ClassInfo;
  type: NotificationType;
}

export function isFatalEmailCode(code: string): boolean {
  return (
    code === 'E_RATE_LIMIT_EXCEEDED' ||
    code === 'E_DAILY_LIMIT_EXCEEDED' ||
    code === 'E_SENDER_NOT_VERIFIED'
  );
}

/**
 * Send batch emails sequentially using Cloudflare Email Service.
 * Cloudflare has no batch API — each email is a separate send() call.
 *
 * @param emails - Array of email configurations
 * @param emailBinding - Cloudflare EMAIL binding (SendEmail)
 * @returns Array of per-email results
 */
export async function sendBatchEmailsOptimized(
  emails: OutboundEmail[],
  emailBinding: SendEmail,
  options: SendBatchEmailOptions = {}
): Promise<EmailResult[]> {
  if (emails.length === 0) {
    return [];
  }

  const fromEmail = options.fromEmail || NOTIFICATION_FROM_EMAIL;

  const results: EmailResult[] = [];

  for (let i = 0; i < emails.length; i++) {
    const email = emails[i];
    const unsubscribeUrl = generateUnsubscribeUrl(email.userId);
    const isSeatAvailable = email.type === 'seat_available';

    try {
      const html = isSeatAvailable
        ? SeatAvailableEmailTemplate(email.classInfo, unsubscribeUrl)
        : InstructorAssignedEmailTemplate(email.classInfo, unsubscribeUrl);

      const response = await emailBinding.send({
        to: email.to,
        from: fromEmail,
        subject: isSeatAvailable
          ? `🎉 Seat Available: ${email.classInfo.subject} ${email.classInfo.catalog_nbr} (${email.classInfo.class_nbr})`
          : `👨‍🏫 Instructor Assigned: ${email.classInfo.subject} ${email.classInfo.catalog_nbr} (${email.classInfo.class_nbr})`,
        html,
        text: stripHtml(html),
        headers: {
          'List-Unsubscribe': `<${unsubscribeUrl}>`,
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        },
      });

      results.push({
        success: true,
        messageId: response.messageId,
      });
    } catch (error) {
      // SAFETY: email binding throws object with code/message per Cloudflare Email contract; narrow thrown error
      const errorObj = error as { code?: string; message?: string };
      const errorMessage = errorObj.message || 'Email send failed';
      const errorCode = errorObj.code || 'UNKNOWN';

      log('Email').error(`Failed to send to ${email.to}: ${errorCode} - ${errorMessage}`);

      if (isFatalEmailCode(errorCode)) {
        results.push({ success: false, error: `${errorCode}: ${errorMessage}` });
        for (let j = i + 1; j < emails.length; j++) {
          results.push({ success: false, error: `Skipped: ${errorCode} limit reached` });
        }
        log('Email').warn(`Stopped batch after ${errorCode} at email ${i + 1}/${emails.length}`);
        break;
      }

      results.push({ success: false, error: `${errorCode}: ${errorMessage}` });
    }

    if (
      emails.length > EMAIL_BATCH_SIZE &&
      (i + 1) % EMAIL_BATCH_SIZE === 0 &&
      i < emails.length - 1
    ) {
      await new Promise<void>((resolve) => setTimeout(resolve, EMAIL_BATCH_DELAY_MS));
    }
  }

  const successCount = results.filter((r) => r.success).length;
  log('Email').info(`Batch complete: ${successCount}/${emails.length} sent successfully`);

  return results;
}
