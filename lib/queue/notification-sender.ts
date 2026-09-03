import type { Database } from '@/lib/db';
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
 * `db` is the request-scoped Drizzle handle created once by the queue/HTTP
 * entry point and threaded through every DB-touching query seam below.
 *
 * `ref` is the SectionRef ({ class_nbr, term }) of the section that changed.
 * Recipient selection is scoped to this exact SectionRef — a class number
 * repeats across terms, so filtering by class_nbr alone would select watchers
 * for the same section number in a different term and send wrong-term emails.
 */
export interface SendSectionNotificationsParams {
  db: Database;
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
  const { db, ref, classInfo, changes, emailBinding, fromEmail } = params;
  const scope = sectionRefKey(ref);

  // Step 1: Fetch watchers — scoped to the full SectionRef (class_nbr + term).
  // A section number repeats across terms, so the term filter is what prevents
  // a transition in one term from selecting watchers in another.
  const watchers = await getNotificationWatchers(db, ref);

  if (watchers.length === 0) {
    log('NotificationSender').info(`No watchers found for ${scope}`);
    return [];
  }

  log('NotificationSender').info(`Found ${watchers.length} watchers for ${scope}`);

  const allWatchIds = watchers.map((w) => w.watch_id);

  // One entry per notification type drives claim, rollback, and email build
  // below, so the seat/instructor branches cannot drift apart.
  const claimTypes: Array<{ type: NotificationType; changed: boolean }> = [
    { type: 'seat_available', changed: changes.seatBecameAvailable },
    { type: 'instructor_assigned', changed: changes.instructorAssigned },
  ];

  // Step 2: Claim notification slots for each change type in parallel; rollback any fulfilled claim
  // if the other rejects (allSettled ensures no leak).
  const claimResults = await Promise.allSettled(
    claimTypes.map(({ type, changed }) =>
      changed
        ? tryRecordNotificationsBatch(db, allWatchIds, type)
        : Promise.resolve(new Set<string>())
    )
  );

  const firstRejection = claimResults.find((r) => r.status === 'rejected');
  if (firstRejection) {
    // Deterministic rollback order: seat then instructor — only rollback real, non-empty claims.
    for (const [i, { type, changed }] of claimTypes.entries()) {
      const result = claimResults[i];
      if (changed && result?.status === 'fulfilled' && result.value.size > 0) {
        await deleteNotificationRecords(db, [...result.value], type);
      }
    }
    // SAFETY: find() returned a rejected settled result; narrow to read its reason for rethrow
    const reason = (firstRejection as PromiseRejectedResult).reason;
    throw reason instanceof Error ? reason : new Error(String(reason));
  }
  const claimedByType = {
    seat_available: new Set<string>(),
    instructor_assigned: new Set<string>(),
  };
  claimTypes.forEach(({ type }, i) => {
    const result = claimResults[i];
    if (result?.status === 'fulfilled') claimedByType[type] = result.value;
  });

  // Step 3: Construct email payloads
  const emailsToSend: Array<OutboundEmail & { watchId: string }> = [];
  for (const watcher of watchers) {
    for (const { type } of claimTypes) {
      if (claimedByType[type].has(watcher.watch_id)) {
        emailsToSend.push({
          to: watcher.email,
          userId: watcher.user_id,
          watchId: watcher.watch_id,
          classInfo,
          type,
        });
      }
    }
  }

  if (emailsToSend.length === 0) {
    log('NotificationSender').info(
      `No emails to send for ${scope}` +
        ` (seat: ${claimedByType.seat_available.size}, instructor: ${claimedByType.instructor_assigned.size})`
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
    try {
      for (const { type } of claimTypes) {
        const failedWatchIds = failedEmails
          .filter((e) => e.email.type === type)
          .map((e) => e.email.watchId);
        if (failedWatchIds.length > 0) {
          await deleteNotificationRecords(db, failedWatchIds, type);
        }
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
