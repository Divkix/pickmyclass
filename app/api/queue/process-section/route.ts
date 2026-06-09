/**
 * Queue Message Processor - Process Single Class Section
 *
 * Thin adapter route called by the queue consumer Worker for each message.
 * Delegates to the section processor orchestrator for the actual pipeline.
 */

import { env } from 'cloudflare:workers';
import { type NextRequest, NextResponse } from 'next/server';
import { classCheckMessageSchema } from '@/lib/api/schemas';
import { mapValidationIssues } from '@/lib/api/validation';
import { ApiError, AuthError, NotFoundError, RateLimitError } from '@/lib/asu/api';
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
    // Authentication: Require CRON_SECRET Bearer token
    const cfEnv = env as unknown as Env;

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

    // Delegate to section processor orchestrator
    try {
      const result = await processSection(class_nbr, term, env);

      if (!result.success) {
        return NextResponse.json(
          { success: false, error: result.error, class_nbr: result.classNbr },
          { status: 500 }
        );
      }

      return NextResponse.json({
        success: true,
        class_nbr: result.classNbr,
        changes_detected: {
          seat_became_available: result.changes.seatBecameAvailable,
          instructor_assigned: result.changes.instructorAssigned,
          seats_filled: result.changes.seatsFilled,
        },
        emails_sent: result.emailsSent,
        processing_time_ms: result.processingTimeMs,
      });
    } catch (processingError) {
      // Non-retryable errors: return 200 so the queue consumer acks the message
      if (processingError instanceof AuthError || processingError instanceof NotFoundError) {
        log('Queue-Processor').error(
          `Non-retryable error for section ${class_nbr}:`,
          (processingError as Error).message
        );
        return NextResponse.json(
          {
            success: false,
            error: (processingError as Error).message,
            retryable: false,
          },
          { status: 200 }
        );
      }

      // Rate limit: return 429 so the queue consumer retries with delay
      if (processingError instanceof RateLimitError) {
        log('Queue-Processor').warn(`Rate limited for section ${class_nbr}, retrying with delay`);
        return NextResponse.json(
          {
            success: false,
            error: (processingError as Error).message,
            retryable: true,
          },
          { status: 429 }
        );
      }

      // Other API errors: return 502 (upstream failure)
      if (processingError instanceof ApiError) {
        log('Queue-Processor').error(
          `API error for section ${class_nbr}:`,
          (processingError as Error).message
        );
        return NextResponse.json(
          {
            success: false,
            error: (processingError as Error).message,
            retryable: true,
          },
          { status: 502 }
        );
      }

      // Unknown errors: re-throw for the outer catch
      throw processingError;
    }
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
