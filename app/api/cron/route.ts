/**
 * Cron Job API Route
 *
 * This route can be triggered externally (e.g., by an external cron service)
 * or internally by the node-cron scheduler.
 *
 * It delegates to the shared cron handler in lib/cron/class-check.ts.
 *
 * Schedule: Every 30 minutes (0,30 * * * *)
 * - :00 minutes -> Even class numbers (0, 2, 4, 6, 8)
 * - :30 minutes -> Odd class numbers (1, 3, 5, 7, 9)
 */

import { type NextRequest, NextResponse } from 'next/server';
import { runClassCheckCron } from '@/lib/cron/class-check';

/**
 * GET handler for cron trigger
 *
 * Requires Bearer token authentication via CRON_SECRET environment variable.
 */
export async function GET(request: NextRequest) {
  // Authentication: Require CRON_SECRET Bearer token
  const authHeader = request.headers.get('authorization');
  const expectedSecret = process.env.CRON_SECRET;

  if (!expectedSecret) {
    console.error('[Cron Route] CRON_SECRET not configured');
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
    console.warn('[Cron Route] Unauthorized request - invalid or missing authentication');

    return NextResponse.json(
      {
        success: false,
        error: 'Unauthorized - this endpoint requires authentication',
      },
      { status: 401 }
    );
  }

  // Delegate to shared cron handler
  const result = await runClassCheckCron();

  // Return appropriate HTTP status based on result
  if (!result.success) {
    // If another cron is already running, return 409 Conflict
    if (result.error?.includes('Another cron job is already running')) {
      return NextResponse.json(
        {
          success: false,
          error: result.error,
          stagger_group: result.staggerGroup,
          duration: result.durationMs,
        },
        { status: 409 }
      );
    }

    // Other errors return 500
    return NextResponse.json(
      {
        success: false,
        error: result.error,
        stagger_group: result.staggerGroup,
        duration: result.durationMs,
      },
      { status: 500 }
    );
  }

  // Success response
  return NextResponse.json({
    success: true,
    sections_enqueued: result.sectionsEnqueued,
    stagger_group: result.staggerGroup,
    duration: result.durationMs,
  });
}
