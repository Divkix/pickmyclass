/**
 * Notification Sender
 *
 * Sends batched email notifications for section changes.
 * Handles: fetch watchers → claim notification slots (atomic dedup) →
 * construct payloads → send emails → rollback on failure → record engagement.
 */

import { deleteNotificationRecords, tryRecordNotificationsBatch } from '@/lib/db/queries';
import { type ClassInfo, sendBatchEmailsOptimized } from '@/lib/email/send';
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
    console.error(`[NotificationSender] Error fetching watchers for ${classNbr}:`, watchersError);
    return [];
  }

  if (!watchers || watchers.length === 0) {
    console.log(`[NotificationSender] No watchers found for ${classNbr}`);
    return [];
  }

  console.log(`[NotificationSender] Found ${watchers.length} watchers for ${classNbr}`);

  const allWatchIds = watchers.map((w: Watcher) => w.watch_id);

  // Step 2: Claim notification slots for each change type
  async function claimSlots(type: 'seat_available' | 'instructor_assigned'): Promise<Set<string>> {
    const claimed = await tryRecordNotificationsBatch(allWatchIds, type);

    // If nothing was claimed, there may be stale records — clean up and retry once
    if (claimed.size === 0 && allWatchIds.length > 0) {
      try {
        await deleteNotificationRecords(allWatchIds, type);
      } catch {
        // best-effort cleanup
      }
      return tryRecordNotificationsBatch(allWatchIds, type);
    }

    return claimed;
  }

  // Claim sequentially to preserve deterministic call order
  const claimedSeatIds = changes.seatBecameAvailable
    ? await claimSlots('seat_available')
    : new Set<string>();
  const claimedInstructorIds = changes.instructorAssigned
    ? await claimSlots('instructor_assigned')
    : new Set<string>();

  // Step 3: Construct email payloads
  const emailsToSend: Array<{
    to: string;
    userId: string;
    watchId: string;
    classInfo: ClassInfo;
    type: 'seat_available' | 'instructor_assigned';
  }> = [];

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
    console.log(
      `[NotificationSender] No emails to send for ${classNbr}` +
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
      console.error(
        `[NotificationSender] Failed to rollback notification records for ${classNbr}:`,
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
  for (const userId of uniqueUserIds) {
    const { error: engagementError } = await serviceClient.rpc('record_engagement_send', {
      p_user_id: userId,
    });
    if (engagementError) {
      console.warn(
        `[NotificationSender] Failed to record engagement for user ${userId}:`,
        engagementError
      );
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
    console.warn(
      `[NotificationSender] ${failCount}/${sentResults.length} notifications failed for ${classNbr}`
    );
  } else {
    console.log(`[NotificationSender] Sent ${successCount} notifications for ${classNbr}`);
  }

  return sentResults;
}
