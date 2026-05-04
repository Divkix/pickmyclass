/**
 * Queue Message Processor - Process Single Class Section
 *
 * This route is called by the queue consumer Worker for each message.
 * It processes a single section: fetch → detect changes → send emails → update DB
 */

import { env } from 'cloudflare:workers';
import { type NextRequest, NextResponse } from 'next/server';
import { createClassWatchSchema } from '@/lib/api/schemas';
import {
  ApiError,
  AuthError,
  type ClassDetails,
  fetchClassFromASU,
  NotFoundError,
  RateLimitError,
} from '@/lib/asu/api';
import {
  deleteNotificationRecords,
  resetNotificationsForSection,
  tryRecordNotificationsBatch,
} from '@/lib/db/queries';
import { type ClassInfo, sendBatchEmailsOptimized } from '@/lib/email/resend';
import { getServiceClient } from '@/lib/supabase/service';
import type { Env } from '@/lib/types/env';
import { timingSafeCompare } from '@/lib/utils/crypto';

// Reuse the class watch schema for queue message validation (same fields)
const classCheckMessageSchema = createClassWatchSchema;

/**
 * Process a single class section message from the queue
 */
export async function POST(request: NextRequest) {
  const startTime = Date.now();

  try {
    // Authentication: Require CRON_SECRET Bearer token
    const authHeader = request.headers.get('authorization');
    const cfEnv = env as unknown as Env;
    const expectedSecret = cfEnv.CRON_SECRET;

    if (!expectedSecret) {
      console.error('[Queue-Processor] CRON_SECRET not configured');
      return NextResponse.json(
        {
          success: false,
          error: 'Server configuration error',
        },
        { status: 500 }
      );
    }

    const isAuthorized =
      authHeader !== null && timingSafeCompare(authHeader, `Bearer ${expectedSecret}`);

    if (!isAuthorized) {
      console.warn('[Queue-Processor] Unauthorized request');
      return NextResponse.json(
        {
          success: false,
          error: 'Unauthorized',
        },
        { status: 401 }
      );
    }

    let rawMessage: unknown;
    try {
      rawMessage = await request.json();
    } catch {
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid message payload',
          retryable: false,
        },
        { status: 200 }
      );
    }

    const messageValidation = classCheckMessageSchema.safeParse(rawMessage);
    if (!messageValidation.success) {
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid message payload',
          details: messageValidation.error.issues.map((issue) => ({
            field: issue.path.join('.'),
            message: issue.message,
          })),
          retryable: false,
        },
        { status: 200 }
      );
    }

    const { class_nbr, term } = messageValidation.data;

    console.log(`[Queue-Processor] Processing section ${class_nbr} (term: ${term})`);

    const serviceClient = getServiceClient();

    // Step 1: Fetch current state from database
    const { data: oldState, error: stateError } = await serviceClient
      .from('class_states')
      .select('*')
      .eq('class_nbr', class_nbr)
      .single();

    if (stateError && stateError.code !== 'PGRST116') {
      console.error(`[Queue-Processor] Error fetching old state for ${class_nbr}:`, stateError);
    }

    // Step 2: Fetch latest data from ASU API
    let newData: ClassDetails;
    try {
      newData = await fetchClassFromASU(class_nbr, term, env);
    } catch (error) {
      if (error instanceof AuthError || error instanceof NotFoundError) {
        console.error(
          `[Queue-Processor] Non-retryable error for section ${class_nbr}:`,
          (error as Error).message
        );
        // Return 200 so the queue consumer acks the message (non-retryable)
        return NextResponse.json(
          { success: false, error: (error as Error).message, retryable: false },
          { status: 200 }
        );
      }
      if (error instanceof RateLimitError) {
        console.warn(
          `[Queue-Processor] Rate limited for section ${class_nbr}, retrying with delay`
        );
        // Return non-2xx so the queue consumer retries (uses wrangler retry_delay: 60s)
        return NextResponse.json(
          { success: false, error: (error as Error).message, retryable: true },
          { status: 429 }
        );
      }
      if (error instanceof ApiError) {
        console.error(
          `[Queue-Processor] API error for section ${class_nbr}:`,
          (error as Error).message
        );
        return NextResponse.json(
          { success: false, error: (error as Error).message, retryable: true },
          { status: 502 }
        );
      }
      // Re-throw unknown errors for the outer catch
      throw error;
    }

    // Step 3: Detect changes using NON-RESERVED seats
    let seatsFilled = false;
    let seatBecameAvailable = false;
    let instructorAssigned = false;

    const getOpenSeats = (
      nonReserved: number | null | undefined,
      totalAvailable: number
    ): number => {
      return nonReserved ?? totalAvailable;
    };

    // When oldState is null (first observation), treat baseline as:
    // - seats_available = 0 (full)
    // - instructor_name = 'Staff'
    // This ensures notifications trigger on first observed open state
    const oldOpenSeats = oldState
      ? getOpenSeats(oldState.non_reserved_seats, oldState.seats_available)
      : 0;
    const oldInstructor = oldState?.instructor_name ?? 'Staff';

    const newOpenSeats = getOpenSeats(newData.non_reserved_seats, newData.seats_available ?? 0);

    if (oldOpenSeats > 0 && newOpenSeats === 0) {
      seatsFilled = true;
    }

    if (oldOpenSeats === 0 && newOpenSeats > 0) {
      seatBecameAvailable = true;
      console.log(`[Queue-Processor] 🎉 Seat available in ${class_nbr}: ${newOpenSeats} seats`);
    }

    if (oldInstructor === 'Staff' && newData.instructor && newData.instructor !== 'Staff') {
      instructorAssigned = true;
      console.log(
        `[Queue-Processor] 👨‍🏫 Instructor assigned in ${class_nbr}: ${newData.instructor}`
      );
    }

    // Step 3A: Reset notifications if seats filled
    if (seatsFilled) {
      await resetNotificationsForSection(class_nbr, 'seat_available');
    }

    // Step 4: Send notifications if changes detected
    let emailsSent = 0;
    if (seatBecameAvailable || instructorAssigned) {
      // Get watchers for this section using get_watchers_for_sections function
      const { data: watchers, error: watchersError } = await serviceClient.rpc(
        'get_watchers_for_sections',
        {
          section_numbers: [class_nbr],
        }
      );

      if (watchersError) {
        console.error(`[Queue-Processor] Error fetching watchers for ${class_nbr}:`, watchersError);
        return NextResponse.json(
          {
            success: false,
            error: `Failed to fetch watchers: ${watchersError.message}`,
            class_nbr,
          },
          { status: 500 }
        );
      } else if (watchers && watchers.length > 0) {
        console.log(`[Queue-Processor] Found ${watchers.length} watchers for ${class_nbr}`);

        const classInfo: ClassInfo = {
          term,
          subject: newData.subject,
          catalog_nbr: newData.catalog_nbr,
          class_nbr,
          title: newData.title,
          instructor_name: newData.instructor,
          seats_available: newData.seats_available ?? 0,
          seats_capacity: newData.seats_capacity ?? 0,
          non_reserved_seats: newData.non_reserved_seats ?? null,
          location: newData.location,
          meeting_times: newData.meeting_times,
        };

        // Batch notification dedup: atomically claim slots for all watchers at once
        const emailsToSend: Array<{
          to: string;
          userId: string;
          watchId: string;
          classInfo: ClassInfo;
          type: 'seat_available' | 'instructor_assigned';
        }> = [];

        const allWatchIds = watchers.map((w: { watch_id: string }) => w.watch_id);

        if (seatBecameAvailable) {
          const recordedSeatIds = await tryRecordNotificationsBatch(allWatchIds, 'seat_available');
          for (const watcher of watchers) {
            if (recordedSeatIds.has(watcher.watch_id)) {
              emailsToSend.push({
                to: watcher.email,
                userId: watcher.user_id,
                watchId: watcher.watch_id,
                classInfo,
                type: 'seat_available' as const,
              });
            }
          }
        }

        if (instructorAssigned) {
          const recordedInstructorIds = await tryRecordNotificationsBatch(
            allWatchIds,
            'instructor_assigned'
          );
          for (const watcher of watchers) {
            if (recordedInstructorIds.has(watcher.watch_id)) {
              emailsToSend.push({
                to: watcher.email,
                userId: watcher.user_id,
                watchId: watcher.watch_id,
                classInfo,
                type: 'instructor_assigned' as const,
              });
            }
          }
        }

        // Send batch emails using optimized batch API
        if (emailsToSend.length > 0) {
          const results = await sendBatchEmailsOptimized(emailsToSend);

          // Count successful sends (notifications already recorded via batch dedup)
          const successfulEmails = results
            .map((r, i) => ({ ...r, email: emailsToSend[i] }))
            .filter((r) => r.success);
          emailsSent = successfulEmails.length;

          // Rollback notification records for failed emails so they can be retried
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
                `[Queue-Processor] Failed to rollback notification records for ${class_nbr}:`,
                rollbackError
              );
              return NextResponse.json(
                { success: false, error: 'Rollback failed' },
                { status: 500 }
              );
            }
          }

          // Record engagement sends for successful emails
          // Uses atomic RPC to track engagement per user
          const uniqueUserIds = [...new Set(successfulEmails.map((e) => e.email.userId))];
          for (const userId of uniqueUserIds) {
            try {
              await serviceClient.rpc('record_engagement_send', {
                p_user_id: userId,
              });
            } catch (engagementError) {
              // Non-fatal: log but don't fail the batch
              console.warn(
                `[Queue-Processor] Failed to record engagement for user ${userId}:`,
                engagementError
              );
            }
          }

          const failed = results.filter((r) => !r.success).length;
          if (failed > 0) {
            console.warn(
              `[Queue-Processor] ⚠️  ${failed} emails failed for ${class_nbr} (${emailsSent} succeeded)`
            );
          } else {
            console.log(`[Queue-Processor] ✉️  Sent ${emailsSent} emails for ${class_nbr}`);
          }
        }
      }
    }

    // Step 5: Upsert class state
    const newState = {
      term,
      subject: newData.subject,
      catalog_nbr: newData.catalog_nbr,
      class_nbr,
      title: newData.title,
      instructor_name: newData.instructor,
      seats_available: newData.seats_available ?? 0,
      seats_capacity: newData.seats_capacity ?? 0,
      non_reserved_seats: newData.non_reserved_seats ?? null,
      location: newData.location,
      meeting_times: newData.meeting_times,
      last_checked_at: new Date().toISOString(),
    };

    const { error: upsertError } = await serviceClient.from('class_states').upsert(newState, {
      onConflict: 'class_nbr',
    });

    if (upsertError) {
      console.error(`[Queue-Processor] Database error for ${class_nbr}:`, upsertError);
      return NextResponse.json({ success: false, error: upsertError.message }, { status: 500 });
    }

    const duration = Date.now() - startTime;
    console.log(`[Queue-Processor] ✅ Completed ${class_nbr} in ${duration}ms`);

    return NextResponse.json({
      success: true,
      class_nbr,
      changes_detected: {
        seat_became_available: seatBecameAvailable,
        instructor_assigned: instructorAssigned,
      },
      emails_sent: emailsSent,
      processing_time_ms: duration,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const duration = Date.now() - startTime;
    console.error(`[Queue-Processor] Error (${duration}ms):`, errorMessage);

    return NextResponse.json(
      {
        success: false,
        error: errorMessage,
        processing_time_ms: duration,
      },
      { status: 500 }
    );
  }
}
