/**
 * BullMQ Queue Worker
 *
 * Processes class-check jobs from the queue. Ported from the Cloudflare Worker
 * implementation at app/api/queue/process-section/route.ts.
 *
 * Job Processing Flow:
 * 1. Fetch old state from database
 * 2. Call scraper with circuit breaker protection
 * 3. Detect changes (seat availability, instructor)
 * 4. Send email notifications via Resend
 * 5. Update state in database
 */

import { type Job, Worker } from 'bullmq';
import { resetNotificationsForSection, tryRecordNotification } from '@/lib/db/queries';
import { type ClassInfo, sendBatchEmailsOptimized } from '@/lib/email/resend';
import { CircuitState, getCircuitBreaker } from '@/lib/redis/circuit-breaker';
import { getServiceClient } from '@/lib/supabase/service';
import { QUEUE_NAMES, WORKER_CONFIG } from './config';
import { getConnectionOptions } from './queues';
import type { ClassCheckJobData, ClassCheckJobResult } from './types';

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
 * Singleton worker instance
 */
let worker: Worker<ClassCheckJobData, ClassCheckJobResult, string> | null = null;

/**
 * Fetch class details from scraper service with circuit breaker protection
 *
 * Uses Redis-based circuit breaker for distributed coordination.
 */
async function fetchClassDetailsWithCircuitBreaker(
  sectionNumber: string,
  term: string
): Promise<ScraperResponse> {
  const circuitBreaker = getCircuitBreaker();

  // Check circuit breaker state
  const checkResult = await circuitBreaker.checkState();

  if (!checkResult.allowed) {
    console.warn(`[Worker] Circuit breaker is ${checkResult.state}: ${checkResult.message}`);
    return {
      success: false,
      error: checkResult.message || `Circuit breaker is ${checkResult.state}`,
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
    await circuitBreaker.recordSuccess();

    return result;
  } catch (error) {
    // Record failure in circuit breaker
    await circuitBreaker.recordFailure();

    throw error;
  }
}

/**
 * Get open seats, preferring non-reserved seats when available
 */
function getOpenSeats(nonReserved: number | null | undefined, totalAvailable: number): number {
  return nonReserved ?? totalAvailable;
}

/**
 * Process a single class check job
 *
 * This is the main job processor that mirrors the logic from
 * app/api/queue/process-section/route.ts
 */
async function processClassCheckJob(
  job: Job<ClassCheckJobData, ClassCheckJobResult, string>
): Promise<ClassCheckJobResult> {
  const startTime = Date.now();
  const { classNbr, term } = job.data;

  console.log(`[Worker] Processing section ${classNbr} (term: ${term}) - Job ${job.id}`);

  try {
    const serviceClient = getServiceClient();

    // Step 1: Fetch OLD state from database
    const { data: oldState, error: stateError } = await serviceClient
      .from('class_states')
      .select('*')
      .eq('class_nbr', classNbr)
      .single();

    if (stateError && stateError.code !== 'PGRST116') {
      console.error(`[Worker] Error fetching old state for ${classNbr}:`, stateError);
    }

    // Step 2: Fetch latest data from scraper with circuit breaker protection
    const scraperResponse = await fetchClassDetailsWithCircuitBreaker(classNbr, term);

    if (!scraperResponse.success || !scraperResponse.data) {
      const error = scraperResponse.error || 'Unknown error';
      console.error(`[Worker] Failed to scrape ${classNbr}: ${error}`);

      // If circuit breaker is OPEN, throw to trigger retry later
      const circuitBreaker = getCircuitBreaker();
      const status = await circuitBreaker.getStatus();
      if (status.state === CircuitState.OPEN) {
        throw new Error(`Circuit breaker is OPEN: ${error}`);
      }

      return {
        success: false,
        classNbr,
        error,
      };
    }

    const newData = scraperResponse.data;

    // Step 3: Detect changes using NON-RESERVED seats
    let seatsFilled = false;
    let seatBecameAvailable = false;
    let instructorAssigned = false;

    if (oldState) {
      const oldOpenSeats = getOpenSeats(oldState.non_reserved_seats, oldState.seats_available);
      const newOpenSeats = getOpenSeats(newData.non_reserved_seats, newData.seats_available ?? 0);

      if (oldOpenSeats > 0 && newOpenSeats === 0) {
        seatsFilled = true;
      }

      if (oldOpenSeats === 0 && newOpenSeats > 0) {
        seatBecameAvailable = true;
        console.log(`[Worker] Seat available in ${classNbr}: ${newOpenSeats} seats`);
      }

      if (
        oldState.instructor_name === 'Staff' &&
        newData.instructor &&
        newData.instructor !== 'Staff'
      ) {
        instructorAssigned = true;
        console.log(`[Worker] Instructor assigned in ${classNbr}: ${newData.instructor}`);
      }
    }

    // Step 3A: Reset notifications if seats filled
    if (seatsFilled) {
      await resetNotificationsForSection(classNbr, 'seat_available');
    }

    // Step 4: Send notifications if changes detected
    let emailsSent = 0;
    if (seatBecameAvailable || instructorAssigned) {
      // Get watchers for this section using the get_watchers_for_sections function
      const { data: watchers, error: watchersError } = await serviceClient.rpc(
        'get_watchers_for_sections',
        {
          section_numbers: [classNbr],
        }
      );

      if (watchersError) {
        console.error(`[Worker] Error fetching watchers:`, watchersError);
      } else if (watchers && watchers.length > 0) {
        console.log(`[Worker] Found ${watchers.length} watchers for ${classNbr}`);

        const classInfo: ClassInfo = {
          term,
          subject: newData.subject,
          catalog_nbr: newData.catalog_nbr,
          class_nbr: classNbr,
          title: newData.title,
          instructor_name: newData.instructor,
          seats_available: newData.seats_available ?? 0,
          seats_capacity: newData.seats_capacity ?? 0,
          non_reserved_seats: newData.non_reserved_seats ?? null,
          location: newData.location,
          meeting_times: newData.meeting_times,
        };

        // Prepare batch email list using ATOMIC notification check
        const emailsToSend: Array<{
          to: string;
          userId: string;
          classInfo: ClassInfo;
          type: 'seat_available' | 'instructor_assigned';
        }> = [];

        // Use atomic check-and-record to prevent duplicate notifications
        for (const watcher of watchers) {
          if (seatBecameAvailable) {
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

          // Count successful sends
          emailsSent = results.filter((r) => r.success).length;

          const failed = results.filter((r) => !r.success).length;
          if (failed > 0) {
            console.warn(
              `[Worker] ${failed} emails failed for ${classNbr} (${emailsSent} succeeded)`
            );
          } else {
            console.log(`[Worker] Sent ${emailsSent} emails for ${classNbr}`);
          }
        }
      }
    }

    // Step 5: Upsert class state
    const newState = {
      term,
      subject: newData.subject,
      catalog_nbr: newData.catalog_nbr,
      class_nbr: classNbr,
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
      console.error(`[Worker] Database error for ${classNbr}:`, upsertError);
      throw new Error(`Database error: ${upsertError.message}`);
    }

    const duration = Date.now() - startTime;
    console.log(`[Worker] Completed ${classNbr} in ${duration}ms`);

    return {
      success: true,
      classNbr,
      seatsAvailable: seatBecameAvailable,
      notificationsSent: emailsSent,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const duration = Date.now() - startTime;
    console.error(`[Worker] Error processing ${classNbr} (${duration}ms):`, errorMessage);

    // Re-throw to trigger BullMQ retry mechanism
    throw error;
  }
}

/**
 * Start the queue worker
 *
 * Creates a BullMQ Worker that processes class-check jobs with
 * the configured concurrency.
 */
export function startWorker(): Worker<ClassCheckJobData, ClassCheckJobResult, string> {
  if (worker) {
    console.log('[Worker] Worker already running');
    return worker;
  }

  try {
    const connection = getConnectionOptions();

    worker = new Worker<ClassCheckJobData, ClassCheckJobResult, string>(
      QUEUE_NAMES.CLASS_CHECK,
      processClassCheckJob,
      {
        connection,
        ...WORKER_CONFIG,
      }
    );

    // Event handlers for logging
    worker.on('completed', (job, result) => {
      console.log(
        `[Worker] Job ${job.id} completed: section ${result.classNbr}, ` +
          `seats=${result.seatsAvailable}, notifications=${result.notificationsSent}`
      );
    });

    worker.on('failed', (job, error) => {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      console.error(
        `[Worker] Job ${job?.id} failed: ${errorMsg}`,
        job ? `(attempt ${job.attemptsMade}/${job.opts.attempts})` : ''
      );
    });

    worker.on('error', (error) => {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      console.error(`[Worker] Worker error: ${errorMsg}`);
    });

    worker.on('stalled', (jobId) => {
      console.warn(`[Worker] Job ${jobId} stalled - will be retried`);
    });

    console.log(
      `[Worker] Started worker for ${QUEUE_NAMES.CLASS_CHECK} ` +
        `(concurrency: ${WORKER_CONFIG.concurrency})`
    );

    return worker;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[Worker] Error starting worker: ${errorMsg}`);
    throw error;
  }
}

/**
 * Stop the queue worker gracefully
 *
 * Waits for currently processing jobs to complete before closing.
 */
export async function stopWorker(): Promise<void> {
  if (!worker) {
    console.log('[Worker] No worker running');
    return;
  }

  try {
    console.log('[Worker] Stopping worker...');

    // Close the worker, waiting for current jobs to finish
    await worker.close();

    console.log('[Worker] Worker stopped');
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[Worker] Error stopping worker: ${errorMsg}`);
    // Don't re-throw - shutdown should continue
  } finally {
    worker = null;
  }
}

/**
 * Get the current worker instance (for testing/monitoring)
 */
export function getWorker(): Worker<ClassCheckJobData, ClassCheckJobResult, string> | null {
  return worker;
}
