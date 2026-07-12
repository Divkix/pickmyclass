/**
 * Section Processor Orchestrator
 *
 * Coordinates the section checking pipeline:
 * fetch old state → fetch new data → detect changes → upsert state → send notifications.
 */

import {
  ApiError,
  AuthError,
  fetchClassFromASU,
  NotFoundError,
  RateLimitError,
} from '@/lib/asu/api';
import { log } from '@/lib/log';
import { resetNotificationsForSection } from '@/lib/db/queries';
import { applySectionRef, type SectionRef } from '@/lib/section-ref';
import type { ClassInfo } from '@/lib/types/class';
import { type ChangeResult, detectChanges } from '@/lib/queue/change-detector';
import { type SentNotification, sendSectionNotifications } from '@/lib/queue/notification-sender';
import { getServiceClient } from '@/lib/supabase/service';
import type { ClassDetails } from '@/lib/types/class';
import type { Env } from '@/lib/types/env';

/**
 * Result of processing a single section.
 */
export interface ProcessingResult {
  success: boolean;
  classNbr: string;
  changes: ChangeResult;
  emailsSent: number;
  processingTimeMs: number;
  error?: string;
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
 * @param ref - SectionRef identifying the section ({ class_nbr, term })
 * @param env - Environment bindings for ASU API and email
 * @returns ProcessingResult with timing info
 */
export async function processSection(
  ref: SectionRef,
  env: Pick<Env, 'ASU_API_BASE_URL' | 'ASU_API_TOKEN' | 'EMAIL' | 'NOTIFICATION_FROM_EMAIL'>
): Promise<ProcessingResult> {
  const { class_nbr: classNbr, term } = ref;
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
      console.error(`[ProcessSection] Error fetching old state for ${classNbr}:`, stateError);
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
      term,
      subject: newData.subject,
      catalog_nbr: newData.catalog_nbr,
      class_nbr: classNbr,
      title: newData.title,
      instructor_name: newData.instructor_name,
      seats_available: newData.seats_available ?? 0,
      seats_capacity: newData.seats_capacity ?? 0,
      non_reserved_seats: newData.non_reserved_seats ?? null,
      location: newData.location,
      meeting_times: newData.meeting_times,
      last_checked_at: new Date().toISOString(),
    };

    const { error: upsertError } = await serviceClient
      .from('class_states')
      .upsert(newState, { onConflict: 'class_nbr,term' });

    if (upsertError) {
      // Return before sending any emails so a retry re-attempts cleanly with no emails sent yet.
      console.error(`[ProcessSection] Database error for ${classNbr}:`, upsertError);
      return {
        success: false,
        classNbr,
        changes,
        emailsSent,
        processingTimeMs: Date.now() - startTime,
        error: upsertError.message,
      };
    }

    // Step 6: Send notifications if changes detected (baseline is now persisted)
    if (changes.seatBecameAvailable || changes.instructorAssigned) {
      const classInfo: ClassInfo = {
        term,
        subject: newData.subject,
        catalog_nbr: newData.catalog_nbr,
        class_nbr: classNbr,
        title: newData.title,
        instructor_name: newData.instructor_name,
        seats_available: newData.seats_available ?? 0,
        seats_capacity: newData.seats_capacity ?? 0,
        non_reserved_seats: newData.non_reserved_seats ?? null,
        location: newData.location,
        meeting_times: newData.meeting_times,
      };

      const sentResults = await sendSectionNotifications({
        ref,
        classInfo,
        changes,
        emailBinding: env.EMAIL,
        fromEmail: env.NOTIFICATION_FROM_EMAIL,
      });

      emailsSent = sentResults.filter((r: SentNotification) => r.success).length;
    }

    const duration = Date.now() - startTime;
    log('ProcessSection').info(`✅ Completed ${classNbr} in ${duration}ms`);

    return {
      success: true,
      classNbr,
      changes,
      emailsSent,
      processingTimeMs: duration,
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[ProcessSection] Error processing ${classNbr}:`, errorMessage);

    // Let caller apply retry / non-retry semantics for known upstream errors
    if (
      error instanceof AuthError ||
      error instanceof NotFoundError ||
      error instanceof RateLimitError ||
      error instanceof ApiError
    ) {
      throw error;
    }

    return {
      success: false,
      classNbr,
      changes: {
        seatBecameAvailable: false,
        seatsFilled: false,
        instructorAssigned: false,
        newOpenSeats: 0,
      },
      emailsSent: 0,
      processingTimeMs: duration,
      error: errorMessage,
    };
  }
}
