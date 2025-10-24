/**
 * Email Templates for Class Notifications
 *
 * Simple HTML templates for seat availability and instructor assignment notifications.
 */

import type { ClassInfo } from '../resend'

/**
 * Seat Available Email Template
 *
 * Sent when a class section that was full now has available seats.
 */
export function SeatAvailableEmailTemplate(classInfo: ClassInfo): string {
  const catalogUrl = `https://catalog.apps.asu.edu/catalog/classes/classlist?keywords=${classInfo.class_nbr}&term=${classInfo.term}`

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Seat Available - ${classInfo.subject} ${classInfo.catalog_nbr}</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
    <h1 style="color: white; margin: 0; font-size: 24px;">🎉 Seat Available!</h1>
  </div>

  <div style="background: #f9fafb; padding: 30px; border-radius: 0 0 10px 10px; border: 1px solid #e5e7eb;">
    <p style="font-size: 16px; margin-top: 0;">
      Great news! A seat just became available in a class you're watching:
    </p>

    <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #667eea;">
      <h2 style="margin: 0 0 10px 0; color: #1f2937; font-size: 20px;">
        ${classInfo.subject} ${classInfo.catalog_nbr}: ${classInfo.title}
      </h2>
      <p style="margin: 5px 0; color: #6b7280; font-size: 14px;">
        <strong>Section:</strong> ${classInfo.class_nbr}
      </p>
      <p style="margin: 5px 0; color: #6b7280; font-size: 14px;">
        <strong>Instructor:</strong> ${classInfo.instructor_name}
      </p>
      ${
        classInfo.location
          ? `<p style="margin: 5px 0; color: #6b7280; font-size: 14px;"><strong>Location:</strong> ${classInfo.location}</p>`
          : ''
      }
      ${
        classInfo.meeting_times
          ? `<p style="margin: 5px 0; color: #6b7280; font-size: 14px;"><strong>Meeting Times:</strong> ${classInfo.meeting_times}</p>`
          : ''
      }
      <p style="margin: 15px 0 5px 0; font-size: 18px; color: #059669; font-weight: bold;">
        ${classInfo.seats_available} of ${classInfo.seats_capacity} seats available
      </p>
    </div>

    <p style="font-size: 14px; color: #6b7280; margin: 20px 0;">
      Act fast! Seats can fill up quickly. Click the button below to register:
    </p>

    <div style="text-align: center; margin: 30px 0;">
      <a href="${catalogUrl}" style="display: inline-block; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 14px 32px; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 16px;">
        View Class on ASU Catalog
      </a>
    </div>

    <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 30px 0;">

    <p style="font-size: 12px; color: #9ca3af; text-align: center; margin: 0;">
      You're receiving this email because you're watching this class on PickMyClass.
      <br>
      This is an automated notification sent by PickMyClass.
    </p>
  </div>
</body>
</html>
  `.trim()
}

/**
 * Instructor Assigned Email Template
 *
 * Sent when a class section's instructor changes from "Staff" to an actual professor.
 */
export function InstructorAssignedEmailTemplate(classInfo: ClassInfo): string {
  const catalogUrl = `https://catalog.apps.asu.edu/catalog/classes/classlist?keywords=${classInfo.class_nbr}&term=${classInfo.term}`

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Instructor Assigned - ${classInfo.subject} ${classInfo.catalog_nbr}</title>
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
        ${classInfo.subject} ${classInfo.catalog_nbr}: ${classInfo.title}
      </h2>
      <p style="margin: 5px 0; color: #6b7280; font-size: 14px;">
        <strong>Section:</strong> ${classInfo.class_nbr}
      </p>
      <p style="margin: 15px 0 5px 0; font-size: 18px; color: #ea580c; font-weight: bold;">
        Instructor: ${classInfo.instructor_name}
      </p>
      ${
        classInfo.location
          ? `<p style="margin: 5px 0; color: #6b7280; font-size: 14px;"><strong>Location:</strong> ${classInfo.location}</p>`
          : ''
      }
      ${
        classInfo.meeting_times
          ? `<p style="margin: 5px 0; color: #6b7280; font-size: 14px;"><strong>Meeting Times:</strong> ${classInfo.meeting_times}</p>`
          : ''
      }
      <p style="margin: 15px 0 5px 0; color: ${classInfo.seats_available > 0 ? '#059669' : '#dc2626'}; font-size: 14px;">
        ${classInfo.seats_available} of ${classInfo.seats_capacity} seats available
      </p>
    </div>

    <p style="font-size: 14px; color: #6b7280; margin: 20px 0;">
      Now that you know who's teaching, you can make an informed decision about enrolling in this class.
    </p>

    <div style="text-align: center; margin: 30px 0;">
      <a href="${catalogUrl}" style="display: inline-block; background: linear-gradient(135deg, #f59e0b 0%, #ea580c 100%); color: white; padding: 14px 32px; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 16px;">
        View Class on ASU Catalog
      </a>
    </div>

    <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 30px 0;">

    <p style="font-size: 12px; color: #9ca3af; text-align: center; margin: 0;">
      You're receiving this email because you're watching this class on PickMyClass.
      <br>
      This is an automated notification sent by PickMyClass.
    </p>
  </div>
</body>
</html>
  `.trim()
}
