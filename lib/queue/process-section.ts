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
import { log } from '@/lib/log';
import { type SectionRef } from '@/lib/section-ref';
import { type ChangeResult, detectChanges } from '@/lib/queue/change-detector';
import { type SentNotification, sendSectionNotifications } from '@/lib/queue/notification-sender';
import { type SectionRetirementOutcome, retireClassSection } from '@/lib/queue/section-retirement';
import type { ClassDetails } from '@/lib/types/class';
import type { Env } from '@/lib/types/env';

/**
 * Result of processing a single section.
 */
interface ProcessingResult {
  success: boolean;
  classNbr: string;
  changes: ChangeResult;
  emailsSent: number;
  processingTimeMs: number;
  error?: string;
  retirement?: SectionRetirementOutcome;
}

/** The two terminal verdicts for a Section Check message. */
type Disposition = 'ack' | 'retry';

export type SectionCheckOutcome = {
  disposition: Disposition;
  result: ProcessingResult;
  httpStatus: 200 | 429 | 502 | 500;
  retryable: boolean;
};

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

/**
 * Process a single class section through the full pipeline.
 *
 * Pipeline steps:
 * 1. Fetch old state from database
 * 2. Fetch latest data from ASU API
 * 3. Detect changes between old and new state
 * 4. Reset notifications if seats filled
 * 5. Upsert new class state
 * 6. Send notifications if seat became available or instructor assigned
 *
 * Returns a SectionCheckOutcome that already carries the ack/retry disposition
 * and HTTP status so callers only translate disposition to transport.
 *
 * Never throws ApiError — those are mapped to an outcome with disposition.
 * Only truly unexpected errors may bubble and should be treated as retry by callers.
 *
 * @param ref - SectionRef identifying the section ({ class_nbr, term })
 * @param env - Environment bindings for ASU API and email
 * @returns SectionCheckOutcome with disposition, result, and transport hints
 */
export async function processSection(
  ref: SectionRef,
  env: Pick<Env, 'ASU_API_BASE_URL' | 'ASU_API_TOKEN' | 'EMAIL' | 'NOTIFICATION_FROM_EMAIL'>
): Promise<SectionCheckOutcome> {
  const { class_nbr: classNbr } = ref;
  const startTime = Date.now();

  let changes: ChangeResult;
  let newData: ClassDetails;
  let emailsSent = 0;

  try {
    // Step 1: Fetch old state from DB by its SectionRef identity (class_nbr + term).
    // Include consecutive_not_found_count for logging; DB helper does authoritative increment atomically.
    const oldState = await readSectionCheckState(ref);

    // null = no rows found — not an error for first observation
    // Step 2: Fetch from ASU API
    newData = await fetchClassFromASU(ref, env);

    // Step 3: Detect changes
    changes = detectChanges(oldState, newData);

    // First observation: when there is no persisted baseline (oldState null),
    // do not treat a currently-open seat / assigned instructor as a fresh transition. This
    // prevents a false "seat available" email on the first check when a watch's initial
    // state-seed failed silently — we only persist the baseline and send nothing this cycle.
    if (!oldState) {
      changes.seatBecameAvailable = false;
      changes.instructorAssigned = false;
    }

    // Step 4: Reset notifications if seats filled
    if (changes.seatsFilled) {
      await resetNotificationsForSection(ref, 'seat_available');
    }

    // Step 5: Upsert new class state BEFORE sending notifications.
    // TRADEOFF — upsert-before-notify / at-least-once vs at-most-once:
    // Persisting the new baseline first guarantees idempotency on retry: a
    // retried message reads the *new* state, so detectChanges no longer re-fires
    // the same transition and duplicate emails are impossible. The cost is a
    // crash window — if the Worker crashes after the upsert but before
    // tryRecordNotificationsBatch claims the notification slots, the baseline
    // has advanced yet no email was sent, so the notification is lost for that
    // transition. This is intentionally preferred over double-send: a lost
    // notification is a single-cycle delay until the next state flip, whereas
    // double-send is user-visible spam. A stronger guarantee would require a
    // transactional RPC (claim_and_upsert) or claim-before-upsert with rollback
    // on upsert failure, but that adds cross-table atomicity complexity without
    // changing the disposition contract (ack vs retry) exposed to callers.
    // Mitigations retained: (1) rollback failure in notification-sender is
    // fail-open (F7) so a partial send still acks, and (2) detectChanges is
    // always computed against the persisted oldState so a retry correctly
    // suppresses re-notification.
    try {
      await upsertClassState(ref, newData);
    } catch (upsertError) {
      // Return before sending any emails so a retry re-attempts cleanly with no emails sent yet.
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

    // Step 6: Send notifications if changes detected (baseline is now persisted)
    if (changes.seatBecameAvailable || changes.instructorAssigned) {
      const sentResults = await sendSectionNotifications({
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
      // 3-strikes auto-cleanup lifecycle (increment/threshold, breaker, cap,
      // watcher fetch, delete, email fan-out) lives in section-retirement.ts;
      // this function keeps only classification and disposition. All NotFound
      // paths ack — never retry.
      const retirement = await retireClassSection({
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

    if (error instanceof RateLimitError) {
      // Transient rate-limit — do NOT increment consecutive_not_found_count; leave count unchanged for NotFound tracking
      return retryOutcome(failedResult(classNbr, duration, errorMessage), 429);
    }

    if (error instanceof ApiError) {
      // Upstream 5xx / ApiError — do NOT increment consecutive_not_found_count; NotFound counter is only for NotFoundError
      return retryOutcome(failedResult(classNbr, duration, errorMessage), 502);
    }

    // Unknown / defensive retry — do NOT touch consecutive_not_found_count
    return retryOutcome(failedResult(classNbr, duration, errorMessage), 500);
  }
}
