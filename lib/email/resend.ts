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
