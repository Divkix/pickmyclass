import {
  ApiError,
  AuthError,
  NotFoundError,
  RateLimitError,
  fetchClassFromASU,
} from '@/lib/asu/api';
import {
  AUTO_CLEANUP_BREAKER_RATIO,
  AUTO_CLEANUP_MAX_EMAILS_PER_CYCLE,
  AUTO_CLEANUP_THRESHOLD,
} from '@/lib/config';
import { execute, queryOne, queryScalar } from '@/lib/db/client';
import {
  type ClassWatcher,
  deleteSectionAndWatches,
  getClassWatchers,
  incrementConsecutiveNotFound,
  resetNotificationsForSection,
  upsertClassState,
} from '@/lib/db/queries';
import { sendAutoCleanupRemovalEmails } from '@/lib/email/templates/auto-cleanup';
import { log } from '@/lib/log';
import { type SectionRef } from '@/lib/section-ref';
import { type ChangeResult, detectChanges } from '@/lib/queue/change-detector';
import { type SentNotification, sendSectionNotifications } from '@/lib/queue/notification-sender';
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
 * Check whether auto-cleanup should be suppressed due to mass NotFound ratio.
 * Queries total class_states count vs flagged (consecutive_not_found_count >=1).
 * If ratio > AUTO_CLEANUP_BREAKER_RATIO, signals breaker tripped.
 * Fails open (returns false) if queries error.
 */
async function shouldSuppressAutoCleanup(): Promise<boolean> {
  try {
    const [total, flagged] = await Promise.all([
      queryScalar<number>('SELECT COUNT(*)::int AS count FROM class_states'),
      queryScalar<number>(
        'SELECT COUNT(*)::int AS count FROM class_states WHERE consecutive_not_found_count >= 1'
      ),
    ]);

    const totalNum = Number(total ?? 0);
    const flaggedNum = Number(flagged ?? 0);

    if (totalNum === 0) return false;

    const ratio = flaggedNum / totalNum;
    log('ProcessSection').info(
      `Breaker check total=${totalNum} flagged=${flaggedNum} ratio=${ratio.toFixed(3)} threshold=${AUTO_CLEANUP_BREAKER_RATIO}`
    );
    if (ratio > AUTO_CLEANUP_BREAKER_RATIO) {
      log('ProcessSection').warn('Auto-cleanup suppressed — breaker tripped');
      return true;
    }
    return false;
  } catch (e) {
    log('ProcessSection').warn('Auto-cleanup breaker check threw, failing open:', e);
    return false;
  }
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
    const oldState = await queryOne<{
      class_nbr: string;
      term: string;
      seats_available: number;
      non_reserved_seats: number | null;
      instructor_name: string | null;
      consecutive_not_found_count: number;
    }>(
      `SELECT class_nbr, term, seats_available, non_reserved_seats, instructor_name,
              consecutive_not_found_count
       FROM class_states WHERE class_nbr = $1 AND term = $2`,
      [ref.class_nbr, ref.term]
    );

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
      // 3-strikes auto-cleanup: increment consecutive_not_found_count and delete after threshold
      let newCount: number;
      try {
        newCount = await incrementConsecutiveNotFound(ref);
      } catch (incrementError) {
        log('ProcessSection').error(
          `Auto-cleanup increment failed for ${ref.term}:${classNbr}:`,
          incrementError
        );
        // Fail open as ack — Never retry NotFound paths even if increment fails
        return ackOutcome(failedResult(classNbr, duration, errorMessage));
      }
      log('ProcessSection').warn(
        `Auto-cleanup increment ${ref.term}:${classNbr} count=${newCount}`
      );

      if (newCount >= AUTO_CLEANUP_THRESHOLD) {
        // Circuit breaker: suppress mass deletion if too many sections are flagged
        let suppressed = false;
        try {
          suppressed = await shouldSuppressAutoCleanup();
        } catch {
          suppressed = false;
        }
        if (suppressed) {
          // Cap count at threshold-1 to avoid immediate re-trigger while breaker is tripped; guard avoids no-op WAL writes
          try {
            await execute(
              `UPDATE class_states SET consecutive_not_found_count = $1
               WHERE class_nbr = $2 AND term = $3
                 AND consecutive_not_found_count != $1`,
              [AUTO_CLEANUP_THRESHOLD - 1, ref.class_nbr, ref.term]
            );
          } catch (capErr) {
            log('ProcessSection').warn(
              `Failed to cap consecutive_not_found_count for ${ref.term}:${classNbr}:`,
              capErr
            );
          }
          return ackOutcome(failedResult(classNbr, duration, errorMessage));
        }
        // Fetch watchers (required) and class info in parallel — watcher failure aborts deletion (fail-open)
        let watchers: ClassWatcher[];
        let classInfo: {
          subject?: string | null;
          catalog_nbr?: string | null;
          title?: string | null;
        } | null;
        try {
          const [watchersResult, classInfoResult] = await Promise.all([
            getClassWatchers(ref),
            (async () => {
              try {
                const stateRow = await queryOne<{
                  subject: string | null;
                  catalog_nbr: string | null;
                  title: string | null;
                }>(
                  'SELECT subject, catalog_nbr, title FROM class_states WHERE class_nbr = $1 AND term = $2',
                  [ref.class_nbr, ref.term]
                );
                return stateRow;
              } catch {
                return null;
              }
            })(),
          ]);
          watchers = watchersResult;
          classInfo = classInfoResult;
          // Intentionally emails truncated set while deleting all watches — 500 cap prevents blast, remaining 9500 are removed silently (one-shot section gone); accepted trade-off vs paging. Logs watchesDeleted vs emailsSent.
          if (watchers.length > AUTO_CLEANUP_MAX_EMAILS_PER_CYCLE) {
            log('ProcessSection').warn(
              `Auto-cleanup cap: ${watchers.length} watchers for ${ref.term}:${ref.class_nbr} exceeds cap ${AUTO_CLEANUP_MAX_EMAILS_PER_CYCLE}, truncating`
            );
            watchers = watchers.slice(0, AUTO_CLEANUP_MAX_EMAILS_PER_CYCLE);
          }
        } catch (watcherError) {
          log('ProcessSection').warn(
            `Auto-cleanup: failed to fetch watchers for ${ref.term}:${classNbr}:`,
            watcherError
          );
          return ackOutcome(failedResult(classNbr, duration, errorMessage));
        }
        let watchesDeleted = 0;
        try {
          const delResult = await deleteSectionAndWatches(ref);
          watchesDeleted = delResult.watchesDeleted;
        } catch (deleteError) {
          log('ProcessSection').error(
            `Auto-cleanup delete failed for ${ref.term}:${classNbr}:`,
            deleteError
          );
          return ackOutcome(failedResult(classNbr, duration, errorMessage));
        }

        if (watchers.length > 0) {
          try {
            await sendAutoCleanupRemovalEmails(
              { ref, classInfo, watchers },
              env.EMAIL,
              env.NOTIFICATION_FROM_EMAIL
            );
          } catch (emailError) {
            log('ProcessSection').warn(
              `Auto-cleanup email failed for ${ref.term}:${classNbr}:`,
              emailError
            );
          }
        }

        log('ProcessSection').info(
          `Auto-cleanup deleted ${ref.term}:${classNbr} watchesDeleted=${watchesDeleted} emailsSent=${watchers.length} (cap ${AUTO_CLEANUP_MAX_EMAILS_PER_CYCLE} prevents blast; remaining ${Math.max(0, watchesDeleted - watchers.length)} silently removed — accepted trade-off vs paging)`
        );

        return ackOutcome({
          success: true,
          classNbr,
          changes: emptyChanges(),
          emailsSent: watchers.length,
          processingTimeMs: duration,
          error: 'Auto-cleanup: class removed after 3 NotFounds',
        });
      }

      // newCount < threshold: ack without deletion
      return ackOutcome(failedResult(classNbr, duration, errorMessage));
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
