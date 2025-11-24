/**
 * Queue Message Processor - Process Single Class Section
 *
 * This route is called by the queue consumer Worker for each message.
 * It processes a single section: scrape → detect changes → send emails → update DB
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCloudflareContext } from '@opennextjs/cloudflare';
import { getServiceClient } from '@/lib/supabase/service';
import { tryRecordNotification, resetNotificationsForSection } from '@/lib/db/queries';
import { sendBatchEmailsOptimized, type ClassInfo } from '@/lib/email/resend';
import type { ClassCheckMessage } from '@/lib/types/queue';

/**
 * Interface for scraper response
 */
interface ScraperResponse {
  success: boolean;
  data?: {
    subject: string;
    catalog_nbr: string;
    title: string;
    instructor: string;
    seats_available?: number;
    seats_capacity?: number;
    non_reserved_seats?: number | null;
    location?: string;
    meeting_times?: string;
  };
  error?: string;
}

/**
 * Fetch class details from scraper service with circuit breaker protection
 *
 * Uses Durable Object circuit breaker for distributed coordination across
 * all Worker isolates. This prevents cascading failures when the scraper
 * is overloaded or down.
 */
async function fetchClassDetailsWithCircuitBreaker(
  sectionNumber: string,
  term: string,
  circuitBreakerStub: DurableObjectStub
): Promise<ScraperResponse> {
  // Check circuit breaker state
  const checkResponse = await circuitBreakerStub.fetch('http://do/check');
  const checkResult = (await checkResponse.json()) as {
    allowed: boolean;
    state: string;
    message?: string;
  };

  if (!checkResult.allowed) {
    console.warn(`[Queue-Processor] Circuit breaker is OPEN: ${checkResult.message}`);
    return {
      success: false,
      error: checkResult.message || 'Circuit breaker is OPEN',
    };
  }

  // Attempt to scrape
  try {
    const scraperUrl = process.env.SCRAPER_URL;
    const scraperToken = process.env.SCRAPER_SECRET_TOKEN;

    if (!scraperUrl || !scraperToken) {
      throw new Error('SCRAPER_URL and SCRAPER_SECRET_TOKEN must be set');
    }

    const response = await fetch(`${scraperUrl}/scrape`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${scraperToken}`,
      },
      body: JSON.stringify({
        sectionNumber,
        term,
      }),
      // Timeout: 90 seconds (matches circuit breaker config)
      signal: AbortSignal.timeout(90000),
    });

    if (!response.ok) {
      throw new Error(`Scraper returned ${response.status}: ${response.statusText}`);
    }

    const result = (await response.json()) as ScraperResponse;

    // Record success in circuit breaker
    await circuitBreakerStub.fetch('http://do/success', {
      method: 'POST',
    });

    return result;
  } catch (error) {
    // Record failure in circuit breaker
    await circuitBreakerStub.fetch('http://do/failure', {
      method: 'POST',
    });

    throw error;
  }
}

/**
 * Process a single class section message from the queue
 */
export async function POST(request: NextRequest) {
  const startTime = Date.now();

  try {
    // Authentication: Require CRON_SECRET Bearer token
    const authHeader = request.headers.get('authorization');
    const expectedSecret = process.env.CRON_SECRET;

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

    const isAuthorized = authHeader === `Bearer ${expectedSecret}`;

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

    // Parse message body
    const message: ClassCheckMessage = await request.json();
    const { class_nbr, term } = message;

    console.log(`[Queue-Processor] Processing section ${class_nbr} (term: ${term})`);

    // Get Cloudflare context and circuit breaker DO stub
    const { env } = await getCloudflareContext<{
      CIRCUIT_BREAKER_DO: DurableObjectNamespace;
    }>();

    if (!env?.CIRCUIT_BREAKER_DO) {
      console.error('[Queue-Processor] CIRCUIT_BREAKER_DO binding not available');
      return NextResponse.json(
        {
          success: false,
          error: 'Circuit breaker not configured',
        },
        { status: 500 }
      );
    }

    // Get Durable Object stub for scraper circuit breaker
    const doId = env.CIRCUIT_BREAKER_DO.idFromName('scraper-circuit-breaker');
    const circuitBreakerStub = env.CIRCUIT_BREAKER_DO.get(doId);

    const serviceClient = getServiceClient();

    // Step 1: Fetch OLD state from database
    const { data: oldState, error: stateError } = await serviceClient
      .from('class_states')
      .select('*')
      .eq('class_nbr', class_nbr)
      .single();

    if (stateError && stateError.code !== 'PGRST116') {
      console.error(`[Queue-Processor] Error fetching old state for ${class_nbr}:`, stateError);
    }

    // Step 2: Fetch latest data from scraper with circuit breaker protection
    const scraperResponse = await fetchClassDetailsWithCircuitBreaker(
      class_nbr,
      term,
      circuitBreakerStub
    );

    if (!scraperResponse.success || !scraperResponse.data) {
      const error = scraperResponse.error || 'Unknown error';
      console.error(`[Queue-Processor] Failed to scrape ${class_nbr}: ${error}`);

      // If circuit breaker is OPEN, return 503 Service Unavailable
      if (error.includes('Circuit breaker is OPEN')) {
        return NextResponse.json({ success: false, error }, { status: 503 });
      }

      return NextResponse.json({ success: false, error }, { status: 500 });
    }

    const newData = scraperResponse.data;

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

    if (oldState) {
      const oldOpenSeats = getOpenSeats(oldState.non_reserved_seats, oldState.seats_available);
      const newOpenSeats = getOpenSeats(newData.non_reserved_seats, newData.seats_available ?? 0);

      if (oldOpenSeats > 0 && newOpenSeats === 0) {
        seatsFilled = true;
      }

      if (oldOpenSeats === 0 && newOpenSeats > 0) {
        seatBecameAvailable = true;
        console.log(`[Queue-Processor] 🎉 Seat available in ${class_nbr}: ${newOpenSeats} seats`);
      }

      if (
        oldState.instructor_name === 'Staff' &&
        newData.instructor &&
        newData.instructor !== 'Staff'
      ) {
        instructorAssigned = true;
        console.log(
          `[Queue-Processor] 👨‍🏫 Instructor assigned in ${class_nbr}: ${newData.instructor}`
        );
      }
    }

    // Step 3A: Reset notifications if seats filled
    if (seatsFilled) {
      await resetNotificationsForSection(class_nbr, 'seat_available');
    }

    // Step 4: Send notifications if changes detected
    let emailsSent = 0;
    if (seatBecameAvailable || instructorAssigned) {
      // Get watchers for this section using the NEW get_watchers_for_sections function
      const { data: watchers, error: watchersError } = await serviceClient.rpc(
        'get_watchers_for_sections',
        {
          section_numbers: [class_nbr],
        }
      );

      if (watchersError) {
        console.error(`[Queue-Processor] Error fetching watchers:`, watchersError);
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

        // Prepare batch email list using ATOMIC notification check
        // This eliminates race conditions in parallel processing
        const emailsToSend: Array<{
          to: string;
          userId: string;
          classInfo: ClassInfo;
          type: 'seat_available' | 'instructor_assigned';
        }> = [];

        // CRITICAL FIX: Use atomic check BEFORE building email list
        // Previously: check-then-send pattern allowed duplicates
        // Now: tryRecordNotification() atomically claims the notification slot
        for (const watcher of watchers) {
          if (seatBecameAvailable) {
            // Atomic check-and-record: only returns true if this worker claimed the slot
            const shouldSend = await tryRecordNotification(watcher.watch_id, 'seat_available');
            if (shouldSend) {
              emailsToSend.push({
                to: watcher.email,
                userId: watcher.user_id,
                classInfo,
                type: 'seat_available',
              });
            }
          }

          if (instructorAssigned) {
            // Atomic check-and-record: only returns true if this worker claimed the slot
            const shouldSend = await tryRecordNotification(watcher.watch_id, 'instructor_assigned');
            if (shouldSend) {
              emailsToSend.push({
                to: watcher.email,
                userId: watcher.user_id,
                classInfo,
                type: 'instructor_assigned',
              });
            }
          }
        }

        // Send batch emails using optimized batch API
        if (emailsToSend.length > 0) {
          const results = await sendBatchEmailsOptimized(emailsToSend);

          // Count successful sends (notifications already recorded via tryRecordNotification)
          emailsSent = results.filter((r) => r.success).length;

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
