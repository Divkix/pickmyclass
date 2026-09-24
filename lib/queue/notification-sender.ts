import type { Database } from '@/lib/db';
import {
  type ClaimedNotification,
  deleteNotificationRecordsByIds,
  getNotificationWatchers,
  tryRecordNotificationsBatch,
} from '@/lib/db/queries';
import { type ClassInfo, type OutboundEmail, sendBatchEmailsOptimized } from '@/lib/email/send';
import { log } from '@/lib/log';
import type { ChangeResult } from '@/lib/queue/change-detector';
import { type SectionRef, sectionRefKey } from '@/lib/section-ref';
import type { NotificationType } from '@/lib/types/notification';

export interface SendSectionNotificationsParams {
  db: Database;
  ref: SectionRef;
  classInfo: ClassInfo;
  changes: ChangeResult;
  emailBinding: SendEmail;
  fromEmail?: string;
}

export interface SentNotification {
  success: boolean;
  watchId: string;
  type: NotificationType;
  error?: string;
}

// Delete the notification ids returned by the claim. Looking the active row up
// again can hit a newer claim that replaced ours after a reset. Best-effort:
// a failed rollback only means those users stay suppressed for the dedup window.
async function rollbackClaims(db: Database, notificationIds: string[]): Promise<void> {
  if (notificationIds.length === 0) return;

  try {
    await deleteNotificationRecordsByIds(db, notificationIds);
  } catch (rollbackError) {
    log('NotificationSender').warn('Failed to rollback notification records:', rollbackError);
  }
}

export async function sendSectionNotifications(
  params: SendSectionNotificationsParams
): Promise<SentNotification[]> {
  const { db, ref, classInfo, changes, emailBinding, fromEmail } = params;
  const scope = sectionRefKey(ref);

  const watchers = await getNotificationWatchers(db, ref);

  if (watchers.length === 0) {
    log('NotificationSender').info(`No watchers found for ${scope}`);

    return [];
  }

  log('NotificationSender').info(`Found ${watchers.length} watchers for ${scope}`);

  const allWatchIds = watchers.map((w) => w.watch_id);

  const claimTypes: Array<{ type: NotificationType; changed: boolean }> = [
    { type: 'seat_available', changed: changes.seatBecameAvailable },
    { type: 'instructor_assigned', changed: changes.instructorAssigned },
  ];

  const claimResults = await Promise.allSettled(
    claimTypes.map(({ type, changed }) =>
      changed
        ? tryRecordNotificationsBatch(db, allWatchIds, type)
        : Promise.resolve([] as ClaimedNotification[])
    )
  );

  const firstRejection = claimResults.find((r) => r.status === 'rejected');

  if (firstRejection) {
    for (const [i, { changed }] of claimTypes.entries()) {
      const result = claimResults[i];

      if (changed && result?.status === 'fulfilled' && result.value.length > 0) {
        await rollbackClaims(
          db,
          result.value.map((claim) => claim.notificationId)
        );
      }
    }

    // SAFETY: find() returned a rejected settled result; narrow to read its reason for rethrow
    const reason = (firstRejection as PromiseRejectedResult).reason;
    throw reason instanceof Error ? reason : new Error(String(reason));
  }

  const claimedByType: Record<NotificationType, ClaimedNotification[]> = {
    seat_available: [],
    instructor_assigned: [],
  };

  claimTypes.forEach(({ type }, i) => {
    const result = claimResults[i];

    if (result?.status === 'fulfilled') claimedByType[type] = result.value;
  });

  const emailsToSend: Array<OutboundEmail & { watchId: string }> = [];

  for (const watcher of watchers) {
    for (const { type } of claimTypes) {
      if (claimedByType[type].some((claim) => claim.watchId === watcher.watch_id)) {
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
        ` (seat: ${claimedByType.seat_available.length}, instructor: ${claimedByType.instructor_assigned.length})`
    );

    return [];
  }

  const results = await sendBatchEmailsOptimized(emailsToSend, emailBinding, {
    fromEmail,
  });

  const failedEmails = results
    .map((r, i) => ({ ...r, email: emailsToSend[i] }))
    .filter((r) => !r.success);

  if (failedEmails.length > 0) {
    for (const { type } of claimTypes) {
      const failedWatchIds = new Set(
        failedEmails.filter((e) => e.email.type === type).map((e) => e.email.watchId)
      );
      const failedNotificationIds = claimedByType[type]
        .filter((claim) => failedWatchIds.has(claim.watchId))
        .map((claim) => claim.notificationId);

      if (failedNotificationIds.length > 0) {
        await rollbackClaims(db, failedNotificationIds);
      }
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
