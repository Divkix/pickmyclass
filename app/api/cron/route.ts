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
import { timingSafeEqual } from 'crypto'
import { getSectionsToCheck } from '@/lib/db/queries'
import type { ClassCheckMessage, Env } from '@/lib/types/queue'
import { getCloudflareContext } from '@opennextjs/cloudflare'

/**
 * Constant-time string comparison to prevent timing attacks
 */
function secureCompare(a: string, b: string): boolean {
  // Reject empty strings
  if (!a || !b) return false

  // For fixed-length tokens (HMAC-SHA256 = 64 chars), early length check is safe
  // Only attackers send wrong-length tokens, so timing leak is acceptable
  if (a.length !== b.length) return false

  const bufferA = Buffer.from(a, 'utf8')
  const bufferB = Buffer.from(b, 'utf8')
  return timingSafeEqual(bufferA, bufferB)
}

/**
 * Main cron handler with staggered checking
 */
export async function GET(request: NextRequest) {
  const startTime = Date.now()
  const lockHolder = `cron-${Date.now()}`
  let lockAcquired = false

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

    // Use constant-time comparison to prevent timing attacks
    const providedToken = authHeader?.replace('Bearer ', '') || ''
    const isAuthorized = secureCompare(providedToken, expectedSecret)

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

    // Get distributed lock to prevent concurrent cron runs
    const context = await getCloudflareContext()
    const env = context.env as unknown as Env

    if (env.CRON_LOCK_DO) {
      const lockId = env.CRON_LOCK_DO.idFromName('class-check-cron-lock')
      const lockStub = env.CRON_LOCK_DO.get(lockId)

      const lockResponse = await lockStub.fetch('http://do/acquire?holder=' + lockHolder, {
        method: 'POST',
      })
      const lockResult = (await lockResponse.json()) as {
        acquired: boolean
        message: string
        lockHolder?: string
      }

      if (!lockResult.acquired) {
        console.warn('[Cron] Lock acquisition failed:', lockResult.message)
        return NextResponse.json(
          {
            success: false,
            error: 'Another cron job is already running',
            details: lockResult.message,
          },
          { status: 409 }
        )
      }

      lockAcquired = true
      console.log('[Cron] Lock acquired successfully')
    } else {
      console.warn('[Cron] CRON_LOCK_DO not available - proceeding without lock')
    }

    // Determine stagger group based on current time
    // Use modulo calculation to properly handle both :00 and :30 minute triggers
    // Math.floor(currentMinute / 30) gives us: 0 for :00-:29, 1 for :30-:59
    // Modulo 2 alternates between 0 and 1 for each 30-minute window
    // Result: :00 → even (0 % 2 = 0), :30 → odd (1 % 2 = 1)
    const now = new Date()
    const currentMinute = now.getMinutes()
    const staggerGroup = Math.floor(currentMinute / 30) % 2 === 0 ? 'even' : 'odd'

    console.log(
      `[Cron] Starting 30-minute class check (stagger: ${staggerGroup}, time: ${now.toISOString()})`
    )

    // Get queue binding (reuse context from lock acquisition)
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
  } finally {
    // Release lock if it was acquired
    if (lockAcquired) {
      try {
        const context = await getCloudflareContext()
        const env = context.env as unknown as Env

        if (env.CRON_LOCK_DO) {
          const lockId = env.CRON_LOCK_DO.idFromName('class-check-cron-lock')
          const lockStub = env.CRON_LOCK_DO.get(lockId)

          await lockStub.fetch('http://do/release?holder=' + lockHolder, {
            method: 'POST',
          })
          console.log('[Cron] Lock released')
        }
      } catch (error) {
        console.error('[Cron] Error releasing lock:', error)
        // Don't throw - lock will auto-expire after 25 minutes
      }
    }
  }
}
