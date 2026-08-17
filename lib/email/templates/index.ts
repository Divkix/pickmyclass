/**
 * Email Templates for Class Notifications
 *
 * Simple HTML templates for seat availability and instructor assignment notifications.
 * User-provided data is escaped to prevent XSS attacks.
 */

import type { ClassInfo } from '@/lib/types/class';
import { DEFAULT_SITE_URL } from '@/lib/config';
import { escapeHtml } from '@/lib/utils/escape-html';
import { buildUrl } from '@/lib/utils/url';

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
  const catalogUrl = buildUrl(siteUrl, '/go/asu', { classNbr: safeClassNbrUrl, term: safeTerm });
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
      Don't want these emails? <a href="${safeUnsubscribeUrl}" style="color: #8C1D40; text-decoration: underline;">Unsubscribe</a>
    </p>
  `.trim();
}

// invariant: both SeatAvailableEmailTemplate and InstructorAssignedEmailTemplate produce HTML
// containing getEmailFooter output and safe.catalogUrl (via buildUrl); see bodyHtml construction below.

/**
 * Shared outer HTML shell for class notification emails.
 * Owns doctype, <html>/<head>/<body>, container, gradient header, footer, and unsubscribe.
 * Callers supply only variant-specific bodyHtml and preheader; gradient + heading derive from variant.
 */
function buildClassEmailShell(opts: {
  variant: 'seat' | 'instructor';
  classInfo: SanitizedClassInfo;
  unsubscribeUrl?: string;
  bodyHtml: string;
  preheader: string;
}): string {
  const isSeat = opts.variant === 'seat';
  const gradientFrom = isSeat ? '#8C1D40' : '#f59e0b';
  const gradientTo = isSeat ? '#6E1733' : '#ea580c';
  const heading = isSeat ? '🎉 Seat Available!' : '👨‍🏫 Instructor Assigned!';
  const titlePrefix = isSeat ? 'Seat Available' : 'Instructor Assigned';
  // classInfo fields are already escaped via sanitizeClassInfo
  const title = `${titlePrefix} - ${opts.classInfo.subject} ${opts.classInfo.catalogNbr}`;

  const preheaderHtml = opts.preheader
    ? `<span style="display:none!important;visibility:hidden;mso-hide:all;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${escapeHtml(opts.preheader)}</span>`
    : '';

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  ${preheaderHtml}
  <div style="background: linear-gradient(135deg, ${gradientFrom} 0%, ${gradientTo} 100%); padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
    <h1 style="color: white; margin: 0; font-size: 24px;">${heading}</h1>
  </div>

  <div style="background: #f9fafb; padding: 30px; border-radius: 0 0 10px 10px; border: 1px solid #e5e7eb;">
    ${opts.bodyHtml}

    <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 30px 0;">

    ${getEmailFooter(opts.unsubscribeUrl)}
  </div>
</body>
</html>
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
  const preheader = `Seat available in ${classInfo.subject} ${classInfo.catalog_nbr} — ${classInfo.title}`;

  const bodyHtml = `
    <p style="font-size: 16px; margin-top: 0;">
      Great news! A seat just became available in a class you're watching:
    </p>

    <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #8C1D40;">
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
      <a href="${safe.catalogUrl}" style="display: inline-block; background: linear-gradient(135deg, #8C1D40 0%, #6E1733 100%); color: white; padding: 14px 32px; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 16px;">
        View Class on ASU Catalog
      </a>
    </div>
  `.trim();

  return buildClassEmailShell({
    variant: 'seat',
    classInfo: safe,
    unsubscribeUrl,
    bodyHtml,
    preheader,
  });
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

  const preheader = `Instructor assigned for ${classInfo.subject} ${classInfo.catalog_nbr} — ${classInfo.instructor_name}`;

  const bodyHtml = `
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
  `.trim();

  return buildClassEmailShell({
    variant: 'instructor',
    classInfo: safe,
    unsubscribeUrl,
    bodyHtml,
    preheader,
  });
}

export { buildAutoCleanupRemovedEmail, sendAutoCleanupRemovalEmails } from './auto-cleanup';
export type { BuildAutoCleanupRemovedEmailParams, AutoCleanupRemovedEmail } from './auto-cleanup';
