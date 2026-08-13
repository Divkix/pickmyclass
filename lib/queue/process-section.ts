/**
 * Section Processor Orchestrator
 *
 * Coordinates the section checking pipeline:
 * fetch old state → fetch new data → detect changes → upsert state → send notifications.
 */

import {
  ApiError,
  AuthError,
  NotFoundError,
  RateLimitError,
  fetchClassFromASU,
} from '@/lib/asu/api';
import { log } from '@/lib/log';
import { resetNotificationsForSection } from '@/lib/db/queries';
import { applySectionRef, type SectionRef } from '@/lib/section-ref';
import { type ChangeResult, detectChanges } from '@/lib/queue/change-detector';
import { type SentNotification, sendSectionNotifications } from '@/lib/queue/notification-sender';
import { getServiceClient } from '@/lib/supabase/service';
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
  const serviceClient = getServiceClient();

  let changes: ChangeResult;
  let newData: ClassDetails;
  let emailsSent = 0;

  try {
    // Step 1: Fetch old state from DB by its SectionRef identity (class_nbr + term).
    const { data: oldState, error: stateError } = await applySectionRef(
      serviceClient.from('class_states').select('*'),
      ref
    ).single();

    // PGRST116 = no rows found — not an error for first observation
    if (stateError && stateError.code !== 'PGRST116') {
      log('ProcessSection').error(`Error fetching old state for ${classNbr}:`, stateError);
    }

    // Step 2: Fetch from ASU API
    newData = await fetchClassFromASU(ref, env);

    // Step 3: Detect changes
    changes = detectChanges(oldState, newData);

    // First observation: when there is no persisted baseline (oldState falsy, e.g. PGRST116),
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
    // Persisting the new baseline first means a retried message reads the *new* state, so
    // detectChanges no longer re-fires the same transition and no duplicate emails are sent.
    const newState = {
      ...newData,
      ...ref,
      last_checked_at: new Date().toISOString(),
    };

    const { error: upsertError } = await serviceClient
      .from('class_states')
      .upsert(newState, { onConflict: 'class_nbr,term' });

    if (upsertError) {
      // Return before sending any emails so a retry re-attempts cleanly with no emails sent yet.
      log('ProcessSection').error(`Database error for ${classNbr}:`, upsertError);
      return retryOutcome(
        {
          success: false,
          classNbr,
          changes,
          emailsSent,
          processingTimeMs: Date.now() - startTime,
          error: upsertError.message,
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

    // Auth/NotFound before ApiError base — both extend ApiError so subclass check must win.
    if (error instanceof AuthError || error instanceof NotFoundError) {
      return ackOutcome(failedResult(classNbr, duration, errorMessage));
    }

    if (error instanceof RateLimitError) {
      return retryOutcome(failedResult(classNbr, duration, errorMessage), 429);
    }

    if (error instanceof ApiError) {
      return retryOutcome(failedResult(classNbr, duration, errorMessage), 502);
    }

    // Unknown / defensive retry
    return retryOutcome(failedResult(classNbr, duration, errorMessage), 500);
  }
}
