/**
 * Notification Sender
 *
 * Sends batched email notifications for section changes.
 * Handles: fetch watchers → claim notification slots (atomic dedup) →
 * construct payloads → send emails → rollback on failure → record engagement.
 */

import { deleteNotificationRecords, tryRecordNotificationsBatch } from '@/lib/db/queries';
import { type ClassInfo, type OutboundEmail, sendBatchEmailsOptimized } from '@/lib/email/send';
import { log } from '@/lib/log';
import type { ChangeResult } from '@/lib/queue/change-detector';
import { getServiceClient } from '@/lib/supabase/service';

/**
 * A single watcher returned from the DB RPC.
 */
interface Watcher {
  user_id: string;
  email: string;
  watch_id: string;
}

/**
 * Parameters for sending section notifications.
 */
export interface SendSectionNotificationsParams {
  classNbr: string;
  classInfo: ClassInfo;
  changes: ChangeResult;
  emailBinding: SendEmail;
  fromEmail?: string;
}

/**
 * Result of sending a single notification email.
 */
export interface SentNotification {
  success: boolean;
  watchId: string;
  type: 'seat_available' | 'instructor_assigned';
  error?: string;
}

/**
 * Fetch watchers for a section, claim notification slots,
 * send emails, and rollback on failure.
 *
 * @returns Array of per-watcher send results
 */
export async function sendSectionNotifications(
  params: SendSectionNotificationsParams
): Promise<SentNotification[]> {
  const { classNbr, classInfo, changes, emailBinding, fromEmail } = params;
  const serviceClient = getServiceClient();

  // Step 1: Fetch watchers
  const { data: watchers, error: watchersError } = await serviceClient.rpc(
    'get_watchers_for_sections',
    { section_numbers: [classNbr] }
  );

  if (watchersError) {
    throw new Error(`Failed to fetch watchers for ${classNbr}: ${watchersError.message}`);
  }

  if (!watchers || watchers.length === 0) {
    log('NotificationSender').info(`No watchers found for ${classNbr}`);
    return [];
  }

  log('NotificationSender').info(`Found ${watchers.length} watchers for ${classNbr}`);

  const allWatchIds = watchers.map((w: Watcher) => w.watch_id);

  // Step 2: Claim notification slots for each change type
  async function claimSlots(type: 'seat_available' | 'instructor_assigned'): Promise<Set<string>> {
    // A record only exists if a notification was already sent and hasn't expired.
    // "0 claimed" means everyone is already (recently) notified — do not resend.
    // Expired records are freed by the scheduled expiry sweep (migration), not by deleting here.
    return tryRecordNotificationsBatch(allWatchIds, type);
  }

  // Claim sequentially to preserve deterministic call order
  const claimedSeatIds = changes.seatBecameAvailable
    ? await claimSlots('seat_available')
    : new Set<string>();
  const claimedInstructorIds = changes.instructorAssigned
    ? await claimSlots('instructor_assigned')
    : new Set<string>();

  // Step 3: Construct email payloads
  const emailsToSend: Array<OutboundEmail & { watchId: string }> = [];

  for (const watcher of watchers as Watcher[]) {
    if (claimedSeatIds.has(watcher.watch_id)) {
      emailsToSend.push({
        to: watcher.email,
        userId: watcher.user_id,
        watchId: watcher.watch_id,
        classInfo,
        type: 'seat_available',
      });
    }
    if (claimedInstructorIds.has(watcher.watch_id)) {
      emailsToSend.push({
        to: watcher.email,
        userId: watcher.user_id,
        watchId: watcher.watch_id,
        classInfo,
        type: 'instructor_assigned',
      });
    }
  }

  if (emailsToSend.length === 0) {
    log('NotificationSender').info(
      `No emails to send for ${classNbr}` +
        ` (seat: ${claimedSeatIds.size}, instructor: ${claimedInstructorIds.size})`
    );
    return [];
  }

  // Step 4: Send batch emails
  const results = await sendBatchEmailsOptimized(emailsToSend, emailBinding, {
    fromEmail,
  });

  // Step 5: Rollback notification records for failed sends
  const failedEmails = results
    .map((r, i) => ({ ...r, email: emailsToSend[i] }))
    .filter((r) => !r.success);

  if (failedEmails.length > 0) {
    const failedSeatWatchIds = failedEmails
      .filter((e) => e.email.type === 'seat_available')
      .map((e) => e.email.watchId);
    const failedInstructorWatchIds = failedEmails
      .filter((e) => e.email.type === 'instructor_assigned')
      .map((e) => e.email.watchId);

    try {
      if (failedSeatWatchIds.length > 0) {
        await deleteNotificationRecords(failedSeatWatchIds, 'seat_available');
      }
      if (failedInstructorWatchIds.length > 0) {
        await deleteNotificationRecords(failedInstructorWatchIds, 'instructor_assigned');
      }
    } catch (rollbackError) {
      log('NotificationSender').error(
        `Failed to rollback notification records for ${classNbr}:`,
        rollbackError
      );
      throw rollbackError;
    }
  }

  // Step 6: Record engagement for successful sends
  const successfulEmails = results
    .map((r, i) => ({ ...r, email: emailsToSend[i] }))
    .filter((r) => r.success);

  const uniqueUserIds = [...new Set(successfulEmails.map((e) => e.email.userId))];
  if (uniqueUserIds.length > 0) {
    const { error: engagementError } = await serviceClient.rpc('record_engagement_send_batch', {
      p_user_ids: uniqueUserIds,
    });
    if (engagementError) {
      log('NotificationSender').warn('Failed to record batch engagement:', engagementError);
    }
  }

  const sentResults: SentNotification[] = results.map((r, i) => ({
    success: r.success,
    watchId: emailsToSend[i].watchId,
    type: emailsToSend[i].type,
    error: r.error,
  }));

  const successCount = sentResults.filter((r) => r.success).length;
  const failCount = sentResults.length - successCount;
  if (failCount > 0) {
    log('NotificationSender').warn(
      `${failCount}/${sentResults.length} notifications failed for ${classNbr}`
    );
  } else {
    log('NotificationSender').info(`Sent ${successCount} notifications for ${classNbr}`);
  }

  return sentResults;
}
