/**
 * Email Service using Resend
 *
 * Handles sending notification emails for class seat availability
 * and instructor assignment changes.
 */

import { Resend } from 'resend'
import {
  SeatAvailableEmailTemplate,
  InstructorAssignedEmailTemplate,
} from './templates'
import { generateUnsubscribeUrl } from './unsubscribe-token'

/**
 * Initialize Resend client
 * Uses placeholder key during build to prevent build failures
 */
const getResendClient = () => {
  const apiKey = process.env.RESEND_API_KEY || 'placeholder-for-build'
  return new Resend(apiKey)
}

/**
 * Class information for email templates
 */
export interface ClassInfo {
  term: string
  subject: string
  catalog_nbr: string
  class_nbr: string
  title: string
  instructor_name: string
  seats_available: number
  seats_capacity: number
  non_reserved_seats?: number | null
  location?: string
  meeting_times?: string
}

/**
 * Email sending result
 */
export interface EmailResult {
  success: boolean
  messageId?: string
  error?: string
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
    const resend = getResendClient()
    const fromEmail = process.env.NOTIFICATION_FROM_EMAIL || 'onboarding@resend.dev'

    // Check if email service is configured
    if (!process.env.RESEND_API_KEY) {
      console.warn('[Email] RESEND_API_KEY not configured - skipping email send')
      return {
        success: false,
        error: 'Email service not configured',
      }
    }

    // Generate unsubscribe URL for CAN-SPAM compliance
    const unsubscribeUrl = generateUnsubscribeUrl(userId)

    const subject = `🎉 Seat Available: ${classInfo.subject} ${classInfo.catalog_nbr} (${classInfo.class_nbr})`

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
    })

    if (error) {
      console.error('[Email] Failed to send seat available email:', error)
      return {
        success: false,
        error: error.message || 'Unknown error',
      }
    }

    console.log(`[Email] Sent seat available email to ${toEmail} (ID: ${data?.id})`)
    return {
      success: true,
      messageId: data?.id,
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    console.error('[Email] Error sending seat available email:', errorMessage)
    return {
      success: false,
      error: errorMessage,
    }
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
    const resend = getResendClient()
    const fromEmail = process.env.NOTIFICATION_FROM_EMAIL || 'onboarding@resend.dev'

    // Check if email service is configured
    if (!process.env.RESEND_API_KEY) {
      console.warn('[Email] RESEND_API_KEY not configured - skipping email send')
      return {
        success: false,
        error: 'Email service not configured',
      }
    }

    // Generate unsubscribe URL for CAN-SPAM compliance
    const unsubscribeUrl = generateUnsubscribeUrl(userId)

    const subject = `👨‍🏫 Instructor Assigned: ${classInfo.subject} ${classInfo.catalog_nbr} (${classInfo.class_nbr})`

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
    })

    if (error) {
      console.error('[Email] Failed to send instructor assigned email:', error)
      return {
        success: false,
        error: error.message || 'Unknown error',
      }
    }

    console.log(
      `[Email] Sent instructor assigned email to ${toEmail} (ID: ${data?.id})`
    )
    return {
      success: true,
      messageId: data?.id,
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    console.error('[Email] Error sending instructor assigned email:', errorMessage)
    return {
      success: false,
      error: errorMessage,
    }
  }
}

/**
 * Send batch emails with rate limiting
 *
 * @param emails - Array of email sending functions
 * @param delayMs - Delay between emails (default 100ms)
 * @returns Array of email results
 */
export async function sendBatchEmails(
  emails: Array<() => Promise<EmailResult>>,
  delayMs = 100
): Promise<EmailResult[]> {
  const results: EmailResult[] = []

  for (const sendEmail of emails) {
    const result = await sendEmail()
    results.push(result)

    // Rate limiting delay between emails
    if (emails.length > 1 && delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs))
    }
  }

  return results
}
