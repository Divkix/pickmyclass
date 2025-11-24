/**
 * Email Service using Resend
 *
 * Handles sending notification emails for class seat availability
 * and instructor assignment changes.
 */

import { Resend } from 'resend';
import { InstructorAssignedEmailTemplate, SeatAvailableEmailTemplate } from './templates';
import { generateUnsubscribeUrl } from './unsubscribe-token';

/**
 * Initialize Resend client
 * Uses placeholder key during build to prevent build failures
 */
const getResendClient = () => {
  const apiKey = process.env.RESEND_API_KEY || 'placeholder-for-build';
  return new Resend(apiKey);
};

/**
 * Common email configuration helper
 * Initializes email service and checks configuration
 */
interface EmailConfig {
  resend: Resend;
  fromEmail: string;
  unsubscribeUrl: string;
}

function initializeEmailConfig(userId: string): EmailConfig | EmailResult {
  // Check if email service is configured
  if (!process.env.RESEND_API_KEY) {
    console.warn('[Email] RESEND_API_KEY not configured - skipping email send');
    return {
      success: false,
      error: 'Email service not configured',
    };
  }

  const resend = getResendClient();
  const fromEmail = process.env.NOTIFICATION_FROM_EMAIL || 'onboarding@resend.dev';
  const unsubscribeUrl = generateUnsubscribeUrl(userId);

  return {
    resend,
    fromEmail,
    unsubscribeUrl,
  };
}

/**
 * Class information for email templates
 */
export interface ClassInfo {
  term: string;
  subject: string;
  catalog_nbr: string;
  class_nbr: string;
  title: string;
  instructor_name: string;
  seats_available: number;
  seats_capacity: number;
  non_reserved_seats?: number | null;
  location?: string;
  meeting_times?: string;
}

/**
 * Email sending result
 */
export interface EmailResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

/**
 * Send seat available notification email
 *
 * @param toEmail - Recipient email address
 * @param userId - User ID for unsubscribe token
 * @param classInfo - Class information
 * @returns Email result
 */
export async function sendSeatAvailableEmail(
  toEmail: string,
  userId: string,
  classInfo: ClassInfo
): Promise<EmailResult> {
  try {
    const config = initializeEmailConfig(userId);

    // Check if initialization failed
    if ('error' in config) {
      return config as EmailResult;
    }

    const { resend, fromEmail, unsubscribeUrl } = config as EmailConfig;

    const subject = `🎉 Seat Available: ${classInfo.subject} ${classInfo.catalog_nbr} (${classInfo.class_nbr})`;

    const { data, error } = await resend.emails.send({
      from: fromEmail,
      to: toEmail,
      subject,
      html: SeatAvailableEmailTemplate(classInfo, unsubscribeUrl),
      headers: {
        // CAN-SPAM compliance: List-Unsubscribe header for one-click unsubscribe
        'List-Unsubscribe': `<${unsubscribeUrl}>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      },
    });

    if (error) {
      console.error('[Email] Failed to send seat available email:', error);
      return {
        success: false,
        error: error.message || 'Unknown error',
      };
    }

    console.log(`[Email] Sent seat available email to ${toEmail} (ID: ${data?.id})`);
    return {
      success: true,
      messageId: data?.id,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Email] Error sending seat available email:', errorMessage);
    return {
      success: false,
      error: errorMessage,
    };
  }
}

/**
 * Send instructor assigned notification email
 *
 * @param toEmail - Recipient email address
 * @param userId - User ID for unsubscribe token
 * @param classInfo - Class information
 * @returns Email result
 */
export async function sendInstructorAssignedEmail(
  toEmail: string,
  userId: string,
  classInfo: ClassInfo
): Promise<EmailResult> {
  try {
    const config = initializeEmailConfig(userId);

    // Check if initialization failed
    if ('error' in config) {
      return config as EmailResult;
    }

    const { resend, fromEmail, unsubscribeUrl } = config as EmailConfig;

    const subject = `👨‍🏫 Instructor Assigned: ${classInfo.subject} ${classInfo.catalog_nbr} (${classInfo.class_nbr})`;

    const { data, error } = await resend.emails.send({
      from: fromEmail,
      to: toEmail,
      subject,
      html: InstructorAssignedEmailTemplate(classInfo, unsubscribeUrl),
      headers: {
        // CAN-SPAM compliance: List-Unsubscribe header for one-click unsubscribe
        'List-Unsubscribe': `<${unsubscribeUrl}>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      },
    });

    if (error) {
      console.error('[Email] Failed to send instructor assigned email:', error);
      return {
        success: false,
        error: error.message || 'Unknown error',
      };
    }

    console.log(`[Email] Sent instructor assigned email to ${toEmail} (ID: ${data?.id})`);
    return {
      success: true,
      messageId: data?.id,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Email] Error sending instructor assigned email:', errorMessage);
    return {
      success: false,
      error: errorMessage,
    };
  }
}

/**
 * Send batch emails using Resend's batch API (up to 100 emails per request)
 * Much faster than sequential sending: 50 emails in 0.5s vs 5s
 *
 * @param emails - Array of email configurations
 * @returns Array of email results
 */
export async function sendBatchEmailsOptimized(
  emails: Array<{
    to: string;
    userId: string;
    classInfo: ClassInfo;
    type: 'seat_available' | 'instructor_assigned';
  }>
): Promise<EmailResult[]> {
  if (emails.length === 0) {
    return [];
  }

  // Check if email service is configured
  if (!process.env.RESEND_API_KEY) {
    console.warn('[Email] RESEND_API_KEY not configured - skipping batch email send');
    return emails.map(() => ({
      success: false,
      error: 'Email service not configured',
    }));
  }

  const resend = getResendClient();
  const fromEmail = process.env.NOTIFICATION_FROM_EMAIL || 'onboarding@resend.dev';

  // Split into chunks of 100 (Resend's batch limit)
  const chunks: (typeof emails)[] = [];
  for (let i = 0; i < emails.length; i += 100) {
    chunks.push(emails.slice(i, i + 100));
  }

  const allResults: EmailResult[] = [];

  for (const chunk of chunks) {
    try {
      // Prepare batch payload
      const batchPayload = chunk.map((email) => {
        const unsubscribeUrl = generateUnsubscribeUrl(email.userId);
        const isSeatAvailable = email.type === 'seat_available';

        return {
          from: fromEmail,
          to: email.to,
          subject: isSeatAvailable
            ? `🎉 Seat Available: ${email.classInfo.subject} ${email.classInfo.catalog_nbr} (${email.classInfo.class_nbr})`
            : `👨‍🏫 Instructor Assigned: ${email.classInfo.subject} ${email.classInfo.catalog_nbr} (${email.classInfo.class_nbr})`,
          html: isSeatAvailable
            ? SeatAvailableEmailTemplate(email.classInfo, unsubscribeUrl)
            : InstructorAssignedEmailTemplate(email.classInfo, unsubscribeUrl),
          headers: {
            'List-Unsubscribe': `<${unsubscribeUrl}>`,
            'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
          },
        };
      });

      // Send batch via Resend API
      const { data, error } = await resend.batch.send(batchPayload);

      if (error) {
        console.error('[Email] Batch send failed:', error);
        // All emails in this batch failed
        allResults.push(
          ...chunk.map(() => ({
            success: false,
            error: error.message || 'Batch send failed',
          }))
        );
      } else {
        console.log(`[Email] Batch sent ${chunk.length} emails successfully`);
        // All emails in this batch succeeded
        allResults.push(
          ...chunk.map((_, index) => ({
            success: true,
            messageId: data?.data?.[index]?.id,
          }))
        );
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('[Email] Batch send error:', errorMessage);
      allResults.push(
        ...chunk.map(() => ({
          success: false,
          error: errorMessage,
        }))
      );
    }

    // Small delay between chunks to avoid rate limiting (if multiple chunks)
    if (chunks.length > 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  return allResults;
}
