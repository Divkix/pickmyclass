/**
 * Cloudflare Workers Cron Job
 *
 * This route is triggered every 30 minutes by Cloudflare Workers cron.
 * It enqueues class sections to the Cloudflare Queue for parallel processing.
 *
 * Cron schedule: "0,30 * * * *" (every 30 minutes)
 * - :00 minutes → Even class numbers (0, 2, 4, 6, 8)
 * - :30 minutes → Odd class numbers (1, 3, 5, 7, 9)
 *
 * Configured in: wrangler.jsonc
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSectionsToCheck } from '@/lib/db/queries'
import type { ClassCheckMessage, Env } from '@/lib/types/queue'

/**
 * Main cron handler with staggered checking
 */
export async function GET(request: NextRequest) {
  const startTime = Date.now()

  try {
    // Authentication: Require CRON_SECRET Bearer token
    const authHeader = request.headers.get('authorization')
    const expectedSecret = process.env.CRON_SECRET

    if (!expectedSecret) {
      console.error('[Cron] CRON_SECRET not configured')
      return NextResponse.json(
        {
          success: false,
          error: 'Server configuration error',
        },
        { status: 500 }
      )
    }

    const isAuthorized = authHeader === `Bearer ${expectedSecret}`

    if (!isAuthorized) {
      console.warn('[Cron] Unauthorized request - invalid or missing authentication')

      return NextResponse.json(
        {
          success: false,
          error: 'Unauthorized - this endpoint requires authentication',
        },
        { status: 401 }
      )
    }

    // Determine stagger group based on current time
    const now = new Date()
    const currentMinute = now.getMinutes()
    const staggerGroup = currentMinute === 0 ? 'even' : 'odd'

    console.log(
      `[Cron] Starting 30-minute class check (stagger: ${staggerGroup}, time: ${now.toISOString()})`
    )

    // Get queue binding from environment
    // @ts-expect-error - env added by worker.ts
    const env = request.env as Env
    const queue = env.CLASS_CHECK_QUEUE

    if (!queue) {
      console.error('[Cron] CLASS_CHECK_QUEUE binding not found')
      return NextResponse.json(
        {
          success: false,
          error: 'Queue binding not configured',
        },
        { status: 500 }
      )
    }

    // Use server-side filtering function to get sections for this stagger group
    const sections = await getSectionsToCheck(staggerGroup)

    console.log(`[Cron] Enqueueing ${sections.length} sections to queue`)

    // ALERT: Check if we have 0 sections to process
    if (sections.length === 0) {
      console.log('[Cron] No sections to check')
      return NextResponse.json({
        success: true,
        message: 'No sections to check',
        sections_enqueued: 0,
        stagger_group: staggerGroup,
        duration: Date.now() - startTime,
      })
    }

    // Enqueue all sections to Cloudflare Queue for parallel processing
    const enqueuePromises = sections.map((section) =>
      queue.send({
        class_nbr: section.class_nbr,
        term: section.term,
        enqueued_at: new Date().toISOString(),
        stagger_group: staggerGroup,
      } satisfies ClassCheckMessage)
    )

    await Promise.all(enqueuePromises)

    const duration = Date.now() - startTime
    console.log(`[Cron] Enqueued ${sections.length} sections in ${duration}ms`)

    return NextResponse.json({
      success: true,
      sections_enqueued: sections.length,
      stagger_group: staggerGroup,
      duration,
    })
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    console.error('[Cron] Fatal error:', errorMessage)

    return NextResponse.json(
      {
        success: false,
        error: errorMessage,
        duration: Date.now() - startTime,
      },
      { status: 500 }
    )
  }
}
