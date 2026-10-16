import type { Database } from "@/lib/db";
import {
  type ClaimedNotification,
  deleteNotificationRecordsByIds,
  getNotificationWatchers,
} from "@/lib/db/queries";
import { type ClassInfo, type OutboundEmail, sendBatchEmailsOptimized } from "@/lib/email/send";
import { log } from "@/lib/log";
import type { ChangeResult } from "@/lib/queue/change-detector";
import {
  claimNotifications,
  confirmNotificationDelivery,
  type NotificationDelivery,
} from "@/lib/queue/notification-claims";
import { type SectionRef, sectionRefKey } from "@/lib/section-ref";
import type { NotificationType } from "@/lib/types/notification";

export interface SendSectionNotificationsParams {
  db: Database;
  ref: SectionRef;
  classInfo: ClassInfo;
  changes: ChangeResult;
  emailBinding: SendEmail;
  fromEmail?: string;
  delivery?: NotificationDelivery;
}

export interface SentNotification {
  success: boolean;
  watchId: string;
  type: NotificationType;
  error?: string;
}

interface ActiveClaim extends ClaimedNotification {
  type: NotificationType;
  status: "unattempted" | "in-flight" | "delivered" | "failed";
}

interface ClaimedEmail extends OutboundEmail {
  claim: ActiveClaim;
}

async function rollbackClaims(db: Database, notificationIds: string[]): Promise<void> {
  if (notificationIds.length === 0) return;

  try {
    await deleteNotificationRecordsByIds(db, notificationIds);
  } catch (error) {
    log("NotificationSender").warn("Failed to rollback notification records:", error);
  }
}

export async function sendSectionNotifications(
  params: SendSectionNotificationsParams,
): Promise<SentNotification[]> {
  const { db, ref, classInfo, changes, emailBinding, fromEmail, delivery } = params;
  const claims: ActiveClaim[] = [];

  try {
    const watchers = await getNotificationWatchers(db, ref);

    if (watchers.length === 0) return [];
    const watchIds = watchers.map((w) => w.watch_id);

    const types: Array<{ type: NotificationType; changed: boolean }> = [
      { type: "seat_available", changed: changes.seatBecameAvailable },
      { type: "instructor_assigned", changed: changes.instructorAssigned },
    ];

    for (const { type, changed } of types) {
      if (!changed) continue;
      const acquired = await claimNotifications(db, watchIds, type, delivery);

      for (const claim of acquired) claims.push({ ...claim, type, status: "unattempted" });
    }

    const emails: ClaimedEmail[] = [];

    for (const watcher of watchers) {
      for (const claim of claims) {
        if (claim.watchId === watcher.watch_id)
          emails.push({
            to: watcher.email,
            userId: watcher.user_id,
            classInfo,
            type: claim.type,
            claim,
          });
      }
    }

    const results = await sendBatchEmailsOptimized(emails, emailBinding, {
      fromEmail,
      onSending: (index) => {
        emails[index].claim.status = "in-flight";
      },
      onResult: async (index, result) => {
        const claim = emails[index].claim;
        claim.status = result.success ? "delivered" : "failed";

        if (result.success && delivery)
          await confirmNotificationDelivery(db, [claim.notificationId], delivery);
      },
    });

    const sent = results.map((result, index): SentNotification => ({
      success: result.success,
      watchId: emails[index].claim.watchId,
      type: emails[index].type,
      error: result.error,
    }));

    const succeeded = sent.filter((r) => r.success).length;
    log("NotificationSender").info(
      `Sent ${succeeded}/${sent.length} notifications for ${sectionRefKey(ref)}`,
    );

    return sent;
  } finally {
    // Delivered and in-flight claims stay: the provider may have accepted them.
    await rollbackClaims(
      db,
      claims.flatMap((claim) =>
        claim.status === "unattempted" || claim.status === "failed" ? [claim.notificationId] : [],
      ),
    );
  }
}
