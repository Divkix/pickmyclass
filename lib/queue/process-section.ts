import {
  ApiError,
  AuthError,
  NotFoundError,
  RateLimitError,
  fetchClassFromASU,
} from '@/lib/asu/api';
import {
  readSectionCheckState,
  resetNotificationsForSection,
  upsertClassState,
} from '@/lib/db/queries';
import type { Database } from '@/lib/db';
import { log } from '@/lib/log';
import { type SectionRef } from '@/lib/section-ref';
import { type ChangeResult, detectChanges } from '@/lib/queue/change-detector';
import { type SentNotification, sendSectionNotifications } from '@/lib/queue/notification-sender';
import { type SectionRetirementOutcome, retireClassSection } from '@/lib/queue/section-retirement';
import type { ClassDetails } from '@/lib/types/class';
import type { Env } from '@/lib/types/env';
import type { ClassCheckMessage } from '@/lib/types/queue';

interface ProcessingResult {
  success: boolean;
  classNbr: string;
  changes: ChangeResult;
  emailsSent: number;
  processingTimeMs: number;
  error?: string;
  retirement?: SectionRetirementOutcome;
}

type Disposition = 'ack' | 'retry';

export type SectionCheckOutcome = {
  disposition: Disposition;
  result: ProcessingResult;
  httpStatus: 200 | 429 | 502 | 500;
  retryable: boolean;
};

export type ProcessSectionDeps = {
  fetchClass: typeof fetchClassFromASU;
};

/**
 * SectionRef plus the queue message's cron cycle stamp (`ClassCheckMessage.cycle`).
 * The worker hands `processSection` the whole message body, so the stamp rides
 * along without a second parameter.
 */
type SectionCheckInput = SectionRef & Pick<ClassCheckMessage, 'cycle'>;

function emptyChanges(): ChangeResult {
  return {
    seatBecameAvailable: false,
    seatsFilled: false,
    instructorAssigned: false,
    newOpenSeats: 0,
  };
}

function ackOutcome(result: ProcessingResult): SectionCheckOutcome {
  return { disposition: 'ack', result, httpStatus: 200, retryable: false };
}

function retryOutcome(result: ProcessingResult, httpStatus: 429 | 502 | 500): SectionCheckOutcome {
  return { disposition: 'retry', result, httpStatus, retryable: true };
}

function failedResult(classNbr: string, duration: number, error: string): ProcessingResult {
  return {
    success: false,
    classNbr,
    changes: emptyChanges(),
    emailsSent: 0,
    processingTimeMs: duration,
    error,
  };
}

export async function processSection(
  db: Database,
  ref: SectionCheckInput,
  env: Pick<Env, 'ASU_API_BASE_URL' | 'ASU_API_TOKEN' | 'EMAIL' | 'NOTIFICATION_FROM_EMAIL'>,
  overrides: Partial<ProcessSectionDeps> = {}
): Promise<SectionCheckOutcome> {
  const { fetchClass = fetchClassFromASU } = overrides;
  const { class_nbr: classNbr, cycle } = ref;
  const startTime = Date.now();

  let changes: ChangeResult;
  let newData: ClassDetails;
  let emailsSent = 0;

  try {
    const oldState = await readSectionCheckState(db, ref);

    // Duplicate enqueue redelivery: this section was already persisted at or
    // after the cycle that produced the message (fixed-width ISO stamps, so the
    // string compare is chronological). Ack without re-fetching ASU.
    if (cycle && oldState?.last_checked_at && oldState.last_checked_at >= cycle) {
      const duration = Date.now() - startTime;
      log('ProcessSection').info(
        `Skipping ${classNbr}: last checked at ${oldState.last_checked_at}, cycle ${cycle}`
      );

      return ackOutcome({
        success: true,
        classNbr,
        changes: emptyChanges(),
        emailsSent: 0,
        processingTimeMs: duration,
      });
    }

    newData = await fetchClass(ref, env, { useCache: false });

    changes = detectChanges(oldState, newData);

    if (!oldState) {
      changes.seatBecameAvailable = false;
      changes.instructorAssigned = false;
    }

    if (changes.seatsFilled) {
      await resetNotificationsForSection(db, ref, 'seat_available');
    }

    // Staff -> X -> Staff -> X must re-notify: when the instructor reverts to Staff,
    // free the instructor_assigned slot. Without this, the next assignment is still
    // suppressed for the remainder of the 24h dedup window.
    const instructorRevertedToStaff =
      oldState !== null &&
      (oldState.instructor_name ?? 'Staff') !== 'Staff' &&
      newData.instructor_name === 'Staff';

    if (instructorRevertedToStaff) {
      await resetNotificationsForSection(db, ref, 'instructor_assigned');
    }

    try {
      await upsertClassState(db, ref, newData);
    } catch (upsertError) {
      log('ProcessSection').error(`Database error for ${classNbr}:`, upsertError);

      return retryOutcome(
        {
          success: false,
          classNbr,
          changes,
          emailsSent,
          processingTimeMs: Date.now() - startTime,
          error: upsertError instanceof Error ? upsertError.message : String(upsertError),
        },
        500
      );
    }

    if (changes.seatBecameAvailable || changes.instructorAssigned) {
      const sentResults = await sendSectionNotifications({
        db,
        ref,
        classInfo: { ...newData, ...ref },
        changes,
        emailBinding: env.EMAIL,
        fromEmail: env.NOTIFICATION_FROM_EMAIL,
      });

      emailsSent = sentResults.filter((r: SentNotification) => r.success).length;
    }

    const duration = Date.now() - startTime;
    log('ProcessSection').info(`✅ Completed ${classNbr} in ${duration}ms`);

    return ackOutcome({
      success: true,
      classNbr,
      changes,
      emailsSent,
      processingTimeMs: duration,
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    log('ProcessSection').error(`Error processing ${classNbr}:`, errorMessage);

    if (error instanceof NotFoundError) {
      const retirement = await retireClassSection({
        db,
        ref,
        emailBinding: env.EMAIL,
        fromEmail: env.NOTIFICATION_FROM_EMAIL,
      });

      if (retirement.deleted) {
        return ackOutcome({
          success: true,
          classNbr,
          changes: emptyChanges(),
          emailsSent: retirement.emailsSucceeded,
          processingTimeMs: duration,
          error: 'Auto-cleanup: class removed after 3 NotFounds',
          retirement,
        });
      }

      return ackOutcome({ ...failedResult(classNbr, duration, errorMessage), retirement });
    }

    if (error instanceof AuthError) {
      return ackOutcome(failedResult(classNbr, duration, errorMessage));
    }

    let retryStatus: 429 | 502 | 500 = 500;

    if (error instanceof RateLimitError) retryStatus = 429;
    else if (error instanceof ApiError) retryStatus = 502;

    return retryOutcome(failedResult(classNbr, duration, errorMessage), retryStatus);
  }
}
