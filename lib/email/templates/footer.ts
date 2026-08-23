/**
 * Shared CAN-SPAM email footer.
 *
 * Single source of truth for the notification footer used by every email
 * template (class notifications and auto-cleanup removal). The unsubscribe
 * URL is escaped before interpolation to prevent XSS via query params.
 */

import { escapeHtml } from '@/lib/utils/escape-html';

/**
 * Generate email footer with unsubscribe link (CAN-SPAM compliance)
 */
export function getEmailFooter(unsubscribeUrl?: string): string {
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
