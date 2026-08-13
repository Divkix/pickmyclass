/**
 * Queue Message Processor - Process Single Class Section
 *
 * Thin adapter route called by the queue consumer Worker for each message.
 * Delegates to the section processor orchestrator for the actual pipeline.
 *
 * Intentional exception: does NOT use ok()/fail() envelope because the queue consumer
 * reads the top-level `retryable` boolean to decide whether to ack or retry the message,
 * and fail() cannot carry arbitrary top-level fields. HTTP status codes (200/429/502)
 * are also part of the queue-consumer contract and must be preserved.
 */

import { env } from 'cloudflare:workers';
import { type NextRequest, NextResponse } from 'next/server';
import { classCheckMessageSchema } from '@/lib/api/schemas';
import { mapValidationIssues } from '@/lib/api/validation';
import { verifyCronSecret } from '@/lib/auth/require-user';
import { log } from '@/lib/log';
import { processSection } from '@/lib/queue/process-section';
import type { Env } from '@/lib/types/env';

/**
 * Process a single class section message from the queue
 */
export async function POST(request: NextRequest) {
  const startTime = Date.now();

  try {
    // SAFETY: Cloudflare Workers env is opaque runtime value; widen to unknown before narrowing to typed Env contract.
    const rawEnv: unknown = env;
    // SAFETY: Env type reflects wrangler.jsonc bindings validated at deploy time; narrowed from unknown.
    const cfEnv = rawEnv as Env;
    if (!cfEnv.CRON_SECRET) {
      log('Queue-Processor').error('CRON_SECRET not configured');
      return NextResponse.json(
        {
          success: false,
          error: 'Server configuration error',
        },
        { status: 500 }
      );
    }

    if (!verifyCronSecret(request, cfEnv.CRON_SECRET)) {
      log('Queue-Processor').warn('Unauthorized request');
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
          details: mapValidationIssues(messageValidation.error),
          retryable: false,
        },
        { status: 200 }
      );
    }

    const { class_nbr, term } = messageValidation.data;

    log('Queue-Processor').info(`Processing section ${class_nbr} (term: ${term})`);

    // Delegate to section processor orchestrator.
    // processSection owns the ack/retry decision; this route only translates
    // outcome.disposition to HTTP: ack → 200, retry → 429/502/500 (from outcome.httpStatus).
    // Preserves ADR 0006 ack→200 invariant.
    const outcome = await processSection({ class_nbr, term }, cfEnv);

    if (outcome.disposition === 'ack') {
      if (outcome.result.success) {
        return NextResponse.json({
          success: true,
          class_nbr: outcome.result.classNbr,
          changes_detected: {
            seat_became_available: outcome.result.changes.seatBecameAvailable,
            instructor_assigned: outcome.result.changes.instructorAssigned,
            seats_filled: outcome.result.changes.seatsFilled,
          },
          emails_sent: outcome.result.emailsSent,
          processing_time_ms: outcome.result.processingTimeMs,
        });
      }

      // ack but non-success (AuthError / NotFoundError) — 200 with retryable:false
      log('Queue-Processor').error(
        `Non-retryable error for section ${class_nbr}:`,
        outcome.result.error ?? 'Unknown error'
      );
      return NextResponse.json(
        {
          success: false,
          error: outcome.result.error,
          retryable: false,
        },
        { status: 200 }
      );
    }

    // retry disposition — use httpStatus from outcome (429/502/500) and retryable:true
    if (outcome.httpStatus === 429) {
      log('Queue-Processor').warn(`Rate limited for section ${class_nbr}, retrying with delay`);
    } else {
      log('Queue-Processor').error(
        `Retryable error for section ${class_nbr}:`,
        outcome.result.error ?? 'Unknown error'
      );
    }
    return NextResponse.json(
      {
        success: false,
        error: outcome.result.error,
        class_nbr: outcome.result.classNbr,
        retryable: true,
      },
      { status: outcome.httpStatus }
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const duration = Date.now() - startTime;
    log('Queue-Processor').error(`Error (${duration}ms):`, errorMessage);

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
