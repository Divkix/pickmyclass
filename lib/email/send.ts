/**
 * Email Service using Cloudflare Email Service Workers Binding
 *
 * Handles sending notification emails for class seat availability
 * and instructor assignment changes via env.EMAIL.send().
 */

import { InstructorAssignedEmailTemplate, SeatAvailableEmailTemplate } from './templates';
import type { ClassInfo } from './types';
import { generateUnsubscribeUrl } from './unsubscribe-token';

export type { ClassInfo } from './types';

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Email sending result
 */
interface EmailResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

interface SendBatchEmailOptions {
  fromEmail?: string;
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
  emails: Array<{
    to: string;
    userId: string;
    classInfo: ClassInfo;
    type: 'seat_available' | 'instructor_assigned';
  }>,
  emailBinding: SendEmail,
  options: SendBatchEmailOptions = {}
): Promise<EmailResult[]> {
  if (emails.length === 0) {
    return [];
  }

  const fromEmail = options.fromEmail || 'notifications@pickmyclass.app';

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
      const errorObj = error as { code?: string; message?: string };
      const errorMessage = errorObj.message || 'Email send failed';
      const errorCode = errorObj.code || 'UNKNOWN';

      console.error(`[Email] Failed to send to ${email.to}: ${errorCode} - ${errorMessage}`);

      // Rate limit or daily limit — stop sending remaining emails
      if (
        errorCode === 'E_RATE_LIMIT_EXCEEDED' ||
        errorCode === 'E_DAILY_LIMIT_EXCEEDED' ||
        errorCode === 'E_SENDER_NOT_VERIFIED'
      ) {
        // Mark current email as failed
        results.push({ success: false, error: `${errorCode}: ${errorMessage}` });
        // Mark remaining emails as skipped
        for (let j = i + 1; j < emails.length; j++) {
          results.push({ success: false, error: `Skipped: ${errorCode} limit reached` });
        }
        console.warn(`[Email] Stopped batch after ${errorCode} at email ${i + 1}/${emails.length}`);
        break;
      }

      // Other errors — mark as failed, continue to next email
      results.push({ success: false, error: `${errorCode}: ${errorMessage}` });
    }

    // Small delay between sends when batch is large (avoid rate limits)
    if (emails.length > 10 && i < emails.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, 75));
    }
  }

  const successCount = results.filter((r) => r.success).length;
  console.log(`[Email] Batch complete: ${successCount}/${emails.length} sent successfully`);

  return results;
}
