/**
 * Cloudflare Workers Cron Job
 *
 * This route is triggered every 30 minutes by Cloudflare Workers cron.
 * It checks monitored class sections in a staggered pattern and updates the database.
 *
 * Cron schedule: "0,30 * * * *" (every 30 minutes)
 * - :00 minutes → Even class numbers (0, 2, 4, 6, 8)
 * - :30 minutes → Odd class numbers (1, 3, 5, 7, 9)
 *
 * Configured in: wrangler.jsonc
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase/service'
import {
  getClassWatchers,
  hasNotificationBeenSent,
  recordNotificationSent,
  resetNotificationsForSection,
} from '@/lib/db/queries'
import {
  sendSeatAvailableEmail,
  sendInstructorAssignedEmail,
  type ClassInfo,
} from '@/lib/email/resend'

/**
 * Configuration
 */
const SCRAPER_BATCH_SIZE = parseInt(process.env.SCRAPER_BATCH_SIZE || '3', 10)

/**
 * Interface for scraper response
 */
interface ScraperResponse {
  success: boolean
  data?: {
    subject: string
    catalog_nbr: string
    title: string
    instructor: string
    seats_available?: number
    seats_capacity?: number
    location?: string
    meeting_times?: string
  }
  error?: string
}

/**
 * Interface for class watch from database
 */
interface ClassWatch {
  class_nbr: string
  term: string
}

/**
 * Sleep utility for rate limiting
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Chunk array into batches of specified size
 */
function chunk<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size))
  }
  return chunks
}

/**
 * Fetch class details from scraper service
 */
async function fetchClassDetails(
  sectionNumber: string,
  term: string
): Promise<ScraperResponse> {
  const scraperUrl = process.env.SCRAPER_URL
  const scraperToken = process.env.SCRAPER_SECRET_TOKEN

  if (!scraperUrl || !scraperToken) {
    throw new Error('SCRAPER_URL and SCRAPER_SECRET_TOKEN must be set')
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
  })

  if (!response.ok) {
    throw new Error(`Scraper returned ${response.status}: ${response.statusText}`)
  }

  return response.json()
}

/**
 * Process a single class section
 */
async function processClassSection(
  watch: ClassWatch,
  serviceClient: ReturnType<typeof getServiceClient>
): Promise<{ success: boolean; error?: string }> {
  try {
    console.log(`[Cron] Processing section ${watch.class_nbr} (term: ${watch.term})`)

    // Step 1: Fetch OLD state from database
    const { data: oldState, error: stateError } = await serviceClient
      .from('class_states')
      .select('*')
      .eq('class_nbr', watch.class_nbr)
      .single()

    if (stateError && stateError.code !== 'PGRST116') {
      console.error(`[Cron] Error fetching old state for ${watch.class_nbr}:`, stateError)
    }

    // Step 2: Fetch latest data from scraper
    const scraperResponse = await fetchClassDetails(watch.class_nbr, watch.term)

    if (!scraperResponse.success || !scraperResponse.data) {
      const error = scraperResponse.error || 'Unknown error'
      console.error(`[Cron] Failed to scrape ${watch.class_nbr}: ${error}`)

      return { success: false, error }
    }

    const newData = scraperResponse.data

    // Step 3: Detect changes
    let seatsFilled = false
    let seatBecameAvailable = false
    let instructorAssigned = false

    if (oldState) {
      // Detect seats filling: was > 0, now = 0
      // This triggers notification reset for hybrid system (Safety Net #1)
      if (oldState.seats_available > 0 && (newData.seats_available ?? 0) === 0) {
        seatsFilled = true
        console.log(
          `[Cron] 🔄 Seats filled in ${watch.class_nbr} - will reset notifications`
        )
      }

      // Detect seat availability change: was 0, now > 0
      if (oldState.seats_available === 0 && (newData.seats_available ?? 0) > 0) {
        seatBecameAvailable = true
        console.log(
          `[Cron] 🎉 Seat became available in ${watch.class_nbr}: ${newData.seats_available} seats`
        )
      }

      // Detect instructor assignment: was "Staff", now has a name
      if (
        oldState.instructor_name === 'Staff' &&
        newData.instructor &&
        newData.instructor !== 'Staff'
      ) {
        instructorAssigned = true
        console.log(
          `[Cron] 👨‍🏫 Instructor assigned in ${watch.class_nbr}: ${newData.instructor}`
        )
      }
    }

    // Step 3A: Reset notifications if seats filled
    if (seatsFilled) {
      try {
        await resetNotificationsForSection(watch.class_nbr, 'seat_available')
        console.log(`[Cron] 🧹 Reset seat_available notifications for ${watch.class_nbr}`)
      } catch (error) {
        console.error(`[Cron] Error resetting notifications for ${watch.class_nbr}:`, error)
        // Continue processing - don't fail entire job due to reset errors
      }
    }

    // Step 4: Send notifications if changes detected
    if (seatBecameAvailable || instructorAssigned) {
      try {
        // Get all users watching this section (filtered by email preferences)
        const watchers = await getClassWatchers(watch.class_nbr)
        console.log(`[Cron] Found ${watchers.length} watchers for ${watch.class_nbr}`)

        // Prepare class info for email templates
        const classInfo: ClassInfo = {
          term: watch.term,
          subject: newData.subject,
          catalog_nbr: newData.catalog_nbr,
          class_nbr: watch.class_nbr,
          title: newData.title,
          instructor_name: newData.instructor,
          seats_available: newData.seats_available ?? 0,
          seats_capacity: newData.seats_capacity ?? 0,
          location: newData.location,
          meeting_times: newData.meeting_times,
        }

        // Send notifications to each watcher
        let emailsSent = 0
        let emailsFailed = 0

        for (const watcher of watchers) {
          // Send seat available notification
          if (seatBecameAvailable) {
            const alreadySent = await hasNotificationBeenSent(
              watcher.watch_id,
              'seat_available'
            )
            if (!alreadySent) {
              const emailResult = await sendSeatAvailableEmail(
                watcher.email,
                watcher.user_id,
                classInfo
              )
              if (emailResult.success) {
                await recordNotificationSent(watcher.watch_id, 'seat_available')
                emailsSent++
                console.log(
                  `[Cron] ✅ Sent seat available email to ${watcher.email} for ${watch.class_nbr}`
                )
              } else {
                emailsFailed++
                console.error(
                  `[Cron] ❌ Failed to send seat available email to ${watcher.email}: ${emailResult.error}`
                )
              }
            } else {
              console.log(
                `[Cron] ⏭️  Skipped seat available email to ${watcher.email} (already sent)`
              )
            }
          }

          // Send instructor assigned notification
          if (instructorAssigned) {
            const alreadySent = await hasNotificationBeenSent(
              watcher.watch_id,
              'instructor_assigned'
            )
            if (!alreadySent) {
              const emailResult = await sendInstructorAssignedEmail(
                watcher.email,
                watcher.user_id,
                classInfo
              )
              if (emailResult.success) {
                await recordNotificationSent(watcher.watch_id, 'instructor_assigned')
                emailsSent++
                console.log(
                  `[Cron] ✅ Sent instructor assigned email to ${watcher.email} for ${watch.class_nbr}`
                )
              } else {
                emailsFailed++
                console.error(
                  `[Cron] ❌ Failed to send instructor assigned email to ${watcher.email}: ${emailResult.error}`
                )
              }
            } else {
              console.log(
                `[Cron] ⏭️  Skipped instructor assigned email to ${watcher.email} (already sent)`
              )
            }
          }

          // Small delay between emails to avoid rate limiting
          await sleep(100)
        }
      } catch (notificationError) {
        console.error(
          `[Cron] Error sending notifications for ${watch.class_nbr}:`,
          notificationError
        )
        // Continue processing - don't fail the entire job due to notification errors
      }
    }

    // Step 5: Upsert class state in PostgreSQL
    const newState = {
      term: watch.term,
      subject: newData.subject,
      catalog_nbr: newData.catalog_nbr,
      class_nbr: watch.class_nbr,
      title: newData.title,
      instructor_name: newData.instructor,
      seats_available: newData.seats_available ?? 0,
      seats_capacity: newData.seats_capacity ?? 0,
      location: newData.location,
      meeting_times: newData.meeting_times,
      last_checked_at: new Date().toISOString(),
    }

    const { error: upsertError } = await serviceClient
      .from('class_states')
      .upsert(newState, {
        onConflict: 'class_nbr',
      })

    if (upsertError) {
      console.error(`[Cron] Database error for ${watch.class_nbr}:`, upsertError)
      return { success: false, error: upsertError.message }
    }

    console.log(`[Cron] Successfully updated ${watch.class_nbr}`)
    return { success: true }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    console.error(`[Cron] Error processing ${watch.class_nbr}:`, errorMessage)

    return { success: false, error: errorMessage }
  }
}

/**
 * Main cron handler with staggered checking
 */
export async function GET(request: NextRequest) {
  const startTime = Date.now()

  try {
    // Authentication: Accept either Cloudflare cron header OR Bearer token
    const authHeader = request.headers.get('authorization')
    const cronHeader = request.headers.get('x-cloudflare-cron')
    const expectedSecret = process.env.CRON_SECRET

    const isAuthorized =
      cronHeader === 'true' || // Cloudflare cron trigger
      (expectedSecret && authHeader === `Bearer ${expectedSecret}`) // Manual trigger with secret

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

    // Get service role client
    const serviceClient = getServiceClient()

    // Fetch all unique class sections being watched
    console.log('[Cron] Using Supabase client for database access')
    const { data, error } = await serviceClient
      .from('class_watches')
      .select('class_nbr, term')
      .order('class_nbr')

    if (error) {
      throw new Error(`Failed to fetch class watches: ${error.message}`)
    }

    // Deduplicate watches by class_nbr
    const uniqueWatches = new Map<string, ClassWatch>()
    for (const watch of data || []) {
      if (!uniqueWatches.has(watch.class_nbr)) {
        uniqueWatches.set(watch.class_nbr, watch as ClassWatch)
      }
    }
    const watches = Array.from(uniqueWatches.values())

    // Apply staggered filtering: split sections by even/odd last digit
    const allWatches = watches
    const filteredWatches = watches.filter((watch) => {
      const lastDigit = parseInt(watch.class_nbr.slice(-1), 10)
      const isEven = lastDigit % 2 === 0
      return staggerGroup === 'even' ? isEven : !isEven
    })

    console.log(
      `[Cron] Found ${filteredWatches.length} sections to check (${staggerGroup}, filtered from ${allWatches.length} total)`
    )

    // ALERT: Check if we have 0 sections to process despite having active watches
    if (filteredWatches.length === 0 && allWatches.length > 0) {
      const message = `Cron job filtered to 0 sections despite ${allWatches.length} active watches`
      console.error(`[Cron] ⚠️  ${message}`)
    }

    if (filteredWatches.length === 0) {
      console.log('[Cron] No sections to check')
      return NextResponse.json({
        success: true,
        message: 'No sections to check',
        duration: Date.now() - startTime,
      })
    }

    // Process in batches to balance speed and rate limiting
    const batches = chunk(filteredWatches, SCRAPER_BATCH_SIZE)
    const results = {
      total: filteredWatches.length,
      successful: 0,
      failed: 0,
      errors: [] as Array<{ class_nbr: string; error: string }>,
    }

    console.log(
      `[Cron] Processing ${batches.length} batches (${SCRAPER_BATCH_SIZE} concurrent per batch)`
    )

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i]
      console.log(`[Cron] Processing batch ${i + 1}/${batches.length}`)

      // Process batch concurrently
      const batchResults = await Promise.all(
        batch.map((watch) => processClassSection(watch, serviceClient))
      )

      // Aggregate results
      for (let j = 0; j < batchResults.length; j++) {
        const result = batchResults[j]
        if (result.success) {
          results.successful++
        } else {
          results.failed++
          results.errors.push({
            class_nbr: batch[j].class_nbr,
            error: result.error || 'Unknown error',
          })
        }
      }

      // Rate limiting: wait 2 seconds between batches (except for last batch)
      if (i < batches.length - 1) {
        console.log('[Cron] Waiting 2s before next batch (rate limiting)...')
        await sleep(2000)
      }
    }

    const duration = Date.now() - startTime

    console.log(
      `[Cron] Completed in ${duration}ms: ${results.successful} successful, ${results.failed} failed`
    )

    // ALERT: If all sections failed, log critical error
    if (results.total > 0 && results.successful === 0) {
      const message = `Cron job processed 0 sections successfully out of ${results.total} attempts`
      console.error(`[Cron] 🚨 CRITICAL: ${message}`)
    }

    // ALERT: If more than 50% failed, log warning
    if (results.failed > 0 && results.failed / results.total > 0.5) {
      const message = `Cron job had high failure rate: ${results.failed}/${results.total} (${Math.round((results.failed / results.total) * 100)}%)`
      console.warn(`[Cron] ⚠️  ${message}`)
    }

    return NextResponse.json({
      success: true,
      results,
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
