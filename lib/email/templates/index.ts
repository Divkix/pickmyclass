/**
 * Email Templates for Class Notifications
 *
 * Simple HTML templates for seat availability and instructor assignment notifications.
 * User-provided data is escaped to prevent XSS attacks.
 */

import type { ClassInfo } from '@/lib/types/class';
import { DEFAULT_SITE_URL } from '@/lib/config';
import { escapeHtml } from '@/lib/utils/escape-html';

/**
 * Sanitize class information for use in email templates
 * Escapes HTML entities and validates URL parameters
 */
interface SanitizedClassInfo {
  subject: string;
  catalogNbr: string;
  title: string;
  classNbr: string;
  instructor: string;
  location: string | null;
  meetingTimes: string | null;
  termUrl: string;
  classNbrUrl: string;
  catalogUrl: string;
}

function sanitizeClassInfo(classInfo: ClassInfo): SanitizedClassInfo {
  // Sanitize all user-provided data
  const safeSubject = escapeHtml(classInfo.subject);
  const safeCatalogNbr = escapeHtml(classInfo.catalog_nbr);
  const safeTitle = escapeHtml(classInfo.title);
  const safeClassNbr = escapeHtml(classInfo.class_nbr);
  const safeInstructor = escapeHtml(classInfo.instructor_name);
  const safeLocation = classInfo.location ? escapeHtml(classInfo.location) : null;
  const safeMeetingTimes = classInfo.meeting_times ? escapeHtml(classInfo.meeting_times) : null;

  // Term and class_nbr are used in URLs - validate format (numbers only)
  const safeTerm = classInfo.term.replace(/[^0-9]/g, '');
  const safeClassNbrUrl = classInfo.class_nbr.replace(/[^0-9]/g, '');

  // Use internal redirect URL to match sending domain (improves email deliverability)
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || DEFAULT_SITE_URL;
  const catalogUrl = `${siteUrl}/go/asu?classNbr=${safeClassNbrUrl}&term=${safeTerm}`;

  return {
    subject: safeSubject,
    catalogNbr: safeCatalogNbr,
    title: safeTitle,
    classNbr: safeClassNbr,
    instructor: safeInstructor,
    location: safeLocation,
    meetingTimes: safeMeetingTimes,
    termUrl: safeTerm,
    classNbrUrl: safeClassNbrUrl,
    catalogUrl,
  };
}

/**
 * Generate email footer with unsubscribe link (CAN-SPAM compliance)
 */
function getEmailFooter(unsubscribeUrl?: string): string {
  if (!unsubscribeUrl) {
    return `
    <p style="font-size: 12px; color: #9ca3af; text-align: center; margin: 0;">
      You're receiving this email because you're watching this class on PickMyClass.
      <br>
      This is an automated notification sent by PickMyClass.
    </p>
    `.trim();
  }

  // Sanitize unsubscribe URL to prevent XSS in query params
  const safeUnsubscribeUrl = escapeHtml(unsubscribeUrl);

  return `
    <p style="font-size: 12px; color: #9ca3af; text-align: center; margin: 0;">
      You're receiving this email because you're watching this class on PickMyClass.
      <br>
      This is an automated notification sent by PickMyClass.
    </p>
    <p style="font-size: 11px; color: #9ca3af; text-align: center; margin: 10px 0 0 0;">
      Don't want these emails? <a href="${safeUnsubscribeUrl}" style="color: #6366f1; text-decoration: underline;">Unsubscribe</a>
    </p>
  `.trim();
}

/**
 * Seat Available Email Template
 *
 * Sent when a class section that was full now has available seats.
 */
export function SeatAvailableEmailTemplate(classInfo: ClassInfo, unsubscribeUrl?: string): string {
  // Sanitize all class information
  const safe = sanitizeClassInfo(classInfo);

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Seat Available - ${safe.subject} ${safe.catalogNbr}</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background: linear-gradient(135deg, #6366F1 0%, #10B981 100%); padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
    <h1 style="color: white; margin: 0; font-size: 24px;">🎉 Seat Available!</h1>
  </div>

  <div style="background: #f9fafb; padding: 30px; border-radius: 0 0 10px 10px; border: 1px solid #e5e7eb;">
    <p style="font-size: 16px; margin-top: 0;">
      Great news! A seat just became available in a class you're watching:
    </p>

    <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #6366F1;">
      <h2 style="margin: 0 0 10px 0; color: #1f2937; font-size: 20px;">
        ${safe.subject} ${safe.catalogNbr}: ${safe.title}
      </h2>
      <p style="margin: 5px 0; color: #6b7280; font-size: 14px;">
        <strong>Section:</strong> ${safe.classNbr}
      </p>
      <p style="margin: 5px 0; color: #6b7280; font-size: 14px;">
        <strong>Instructor:</strong> ${safe.instructor}
      </p>
      ${
        safe.location
          ? `<p style="margin: 5px 0; color: #6b7280; font-size: 14px;"><strong>Location:</strong> ${safe.location}</p>`
          : ''
      }
      ${
        safe.meetingTimes
          ? `<p style="margin: 5px 0; color: #6b7280; font-size: 14px;"><strong>Meeting Times:</strong> ${safe.meetingTimes}</p>`
          : ''
      }
      <p style="margin: 15px 0 5px 0; font-size: 18px; color: #10B981; font-weight: bold;">
        ${classInfo.seats_available} open seat${classInfo.seats_available !== 1 ? 's' : ''} available
      </p>
    </div>

    <p style="font-size: 14px; color: #6b7280; margin: 20px 0;">
      Act fast! Seats can fill up quickly. Click the button below to register:
    </p>

    <div style="text-align: center; margin: 30px 0;">
      <a href="${safe.catalogUrl}" style="display: inline-block; background: linear-gradient(135deg, #6366F1 0%, #10B981 100%); color: white; padding: 14px 32px; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 16px;">
        View Class on ASU Catalog
      </a>
    </div>

    <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 30px 0;">

    ${getEmailFooter(unsubscribeUrl)}
  </div>
</body>
</html>
  `.trim();
}

/**
 * Instructor Assigned Email Template
 *
 * Sent when a class section's instructor changes from "Staff" to an actual professor.
 */
export function InstructorAssignedEmailTemplate(
  classInfo: ClassInfo,
  unsubscribeUrl?: string
): string {
  // Sanitize all class information
  const safe = sanitizeClassInfo(classInfo);

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Instructor Assigned - ${safe.subject} ${safe.catalogNbr}</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background: linear-gradient(135deg, #f59e0b 0%, #ea580c 100%); padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
    <h1 style="color: white; margin: 0; font-size: 24px;">👨‍🏫 Instructor Assigned!</h1>
  </div>

  <div style="background: #f9fafb; padding: 30px; border-radius: 0 0 10px 10px; border: 1px solid #e5e7eb;">
    <p style="font-size: 16px; margin-top: 0;">
      An instructor has been assigned to a class you're watching:
    </p>

    <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #f59e0b;">
      <h2 style="margin: 0 0 10px 0; color: #1f2937; font-size: 20px;">
        ${safe.subject} ${safe.catalogNbr}: ${safe.title}
      </h2>
      <p style="margin: 5px 0; color: #6b7280; font-size: 14px;">
        <strong>Section:</strong> ${safe.classNbr}
      </p>
      <p style="margin: 15px 0 5px 0; font-size: 18px; color: #ea580c; font-weight: bold;">
        Instructor: ${safe.instructor}
      </p>
      ${
        safe.location
          ? `<p style="margin: 5px 0; color: #6b7280; font-size: 14px;"><strong>Location:</strong> ${safe.location}</p>`
          : ''
      }
      ${
        safe.meetingTimes
          ? `<p style="margin: 5px 0; color: #6b7280; font-size: 14px;"><strong>Meeting Times:</strong> ${safe.meetingTimes}</p>`
          : ''
      }
      <p style="margin: 15px 0 5px 0; color: ${classInfo.seats_available > 0 ? '#10B981' : '#dc2626'}; font-size: 14px;">
        ${classInfo.seats_available} of ${classInfo.seats_capacity} seats available
      </p>
    </div>

    <p style="font-size: 14px; color: #6b7280; margin: 20px 0;">
      Now that you know who's teaching, you can make an informed decision about enrolling in this class.
    </p>

    <div style="text-align: center; margin: 30px 0;">
      <a href="${safe.catalogUrl}" style="display: inline-block; background: linear-gradient(135deg, #f59e0b 0%, #ea580c 100%); color: white; padding: 14px 32px; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 16px;">
        View Class on ASU Catalog
      </a>
    </div>

    <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 30px 0;">

    ${getEmailFooter(unsubscribeUrl)}
  </div>
</body>
</html>
  `.trim();
}
