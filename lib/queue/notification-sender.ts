import {
  deleteNotificationRecords,
  getNotificationWatchers,
  tryRecordNotificationsBatch,
} from '@/lib/db/queries';
import { type ClassInfo, type OutboundEmail, sendBatchEmailsOptimized } from '@/lib/email/send';
import { log } from '@/lib/log';
import type { ChangeResult } from '@/lib/queue/change-detector';
import { type SectionRef, sectionRefKey } from '@/lib/section-ref';
import type { NotificationType } from '@/lib/types/notification';
/**
 * Parameters for sending section notifications.
 *
 * `ref` is the SectionRef ({ class_nbr, term }) of the section that changed.
 * Recipient selection is scoped to this exact SectionRef — a class number
 * repeats across terms, so filtering by class_nbr alone would select watchers
 * for the same section number in a different term and send wrong-term emails.
 */
export interface SendSectionNotificationsParams {
  ref: SectionRef;
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
  type: NotificationType;
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
  const { ref, classInfo, changes, emailBinding, fromEmail } = params;
  const scope = sectionRefKey(ref);

  // Step 1: Fetch watchers — scoped to the full SectionRef (class_nbr + term).
  // A section number repeats across terms, so the term filter is what prevents
  // a transition in one term from selecting watchers in another.
  const watchers = await getNotificationWatchers(ref);

  if (watchers.length === 0) {
    log('NotificationSender').info(`No watchers found for ${scope}`);
    return [];
  }

  log('NotificationSender').info(`Found ${watchers.length} watchers for ${scope}`);

  const allWatchIds = watchers.map((w) => w.watch_id);

  // Step 2: Claim notification slots for each change type in parallel; rollback any fulfilled claim
  // if the other rejects (allSettled ensures no leak).
  const seatClaim = changes.seatBecameAvailable
    ? tryRecordNotificationsBatch(allWatchIds, 'seat_available')
    : Promise.resolve(new Set<string>());
  const instructorClaim = changes.instructorAssigned
    ? tryRecordNotificationsBatch(allWatchIds, 'instructor_assigned')
    : Promise.resolve(new Set<string>());
  const [seatResult, instructorResult] = await Promise.allSettled([seatClaim, instructorClaim]);

  if (seatResult.status === 'rejected' || instructorResult.status === 'rejected') {
    // Deterministic rollback order: seat then instructor — only rollback real, non-empty claims.
    if (
      seatResult.status === 'fulfilled' &&
      seatResult.value.size > 0 &&
      changes.seatBecameAvailable
    ) {
      await deleteNotificationRecords([...seatResult.value], 'seat_available');
    }
    if (
      instructorResult.status === 'fulfilled' &&
      instructorResult.value.size > 0 &&
      changes.instructorAssigned
    ) {
      await deleteNotificationRecords([...instructorResult.value], 'instructor_assigned');
    }
    // SAFETY: re-narrowing after status check; instructorResult is the rejected branch when seat fulfilled
    const firstRejection =
      seatResult.status === 'rejected'
        ? seatResult.reason
        : (instructorResult as PromiseRejectedResult).reason;
    // SAFETY: firstRejection is the rejected reason from allSettled; narrow to Error for throw contract
    throw firstRejection instanceof Error ? firstRejection : new Error(String(firstRejection));
  }
  // SAFETY: branch above threw if either rejected; both are fulfilled here per control flow narrowing
  const claimedSeatIds = (seatResult as PromiseFulfilledResult<Set<string>>).value;
  // SAFETY: same narrowing as above — fulfilled branch only
  const claimedInstructorIds = (instructorResult as PromiseFulfilledResult<Set<string>>).value;

  // Step 3: Construct email payloads
  const emailsToSend: Array<OutboundEmail & { watchId: string }> = [];
  for (const watcher of watchers) {
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
      `No emails to send for ${scope}` +
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
      log('NotificationSender').warn(
        `Failed to rollback notification records for ${scope}:`,
        rollbackError
      );
      // do not throw — caller processSection already upserted baseline, so retry
      // would find no change and notification suppression would discard the retry
      // anyway. Throwing here would cause a useless retry + 24h suppression window
      // while losing the successful sends. Fail open and return partial results.
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
      `${failCount}/${sentResults.length} notifications failed for ${scope}`
    );
  } else {
    log('NotificationSender').info(`Sent ${successCount} notifications for ${scope}`);
  }

  return sentResults;
}
