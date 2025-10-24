/**
 * Cloudflare Workers Cron Job
 *
 * This route is triggered every hour by Cloudflare Workers cron.
 * It checks all monitored class sections and updates the database.
 *
 * Cron schedule: "0 * * * *" (every hour at :00)
 * Configured in: wrangler.jsonc
 */

import { NextRequest, NextResponse } from 'next/server'
import { queryHyperdrive, type Hyperdrive } from '@/lib/db/hyperdrive'
import { getServiceClient } from '@/lib/supabase/service'

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

    // Fetch latest data from scraper
    const scraperResponse = await fetchClassDetails(watch.class_nbr, watch.term)

    if (!scraperResponse.success || !scraperResponse.data) {
      const error = scraperResponse.error || 'Unknown error'
      console.error(`[Cron] Failed to scrape ${watch.class_nbr}: ${error}`)
      return { success: false, error }
    }

    const data = scraperResponse.data

    // Upsert class state in database
    const { error: upsertError } = await serviceClient
      .from('class_states')
      .upsert(
        {
          term: watch.term,
          subject: data.subject,
          catalog_nbr: data.catalog_nbr,
          class_nbr: watch.class_nbr,
          title: data.title,
          instructor_name: data.instructor,
          seats_available: data.seats_available ?? 0,
          seats_capacity: data.seats_capacity ?? 0,
          location: data.location,
          meeting_times: data.meeting_times,
          last_checked_at: new Date().toISOString(),
        },
        {
          onConflict: 'class_nbr',
        }
      )

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
 * Main cron handler
 */
export async function GET(request: NextRequest) {
  const startTime = Date.now()
  console.log('[Cron] Starting hourly class check')

  try {
    // Verify request is from Cloudflare Workers cron
    const cronHeader = request.headers.get('X-Cloudflare-Cron')
    if (cronHeader !== 'true') {
      console.warn('[Cron] Unauthorized request - missing X-Cloudflare-Cron header')
      return NextResponse.json(
        {
          success: false,
          error: 'Unauthorized - this endpoint can only be called by Cloudflare Workers cron',
        },
        { status: 401 }
      )
    }

    // Get service role client
    const serviceClient = getServiceClient()

    // Fetch all unique class sections being watched
    // Try to use Hyperdrive if available (Cloudflare Workers), otherwise use Supabase client (dev)
    let watches: ClassWatch[] = []

    // @ts-expect-error - Cloudflare Workers env types
    const env = request.env as { HYPERDRIVE?: Hyperdrive }

    if (env?.HYPERDRIVE) {
      console.log('[Cron] Using Hyperdrive for database access')
      const result = await queryHyperdrive(
        env.HYPERDRIVE,
        `SELECT DISTINCT class_nbr, term FROM class_watches ORDER BY class_nbr`
      )
      watches = result.rows as ClassWatch[]
    } else {
      console.log('[Cron] Using Supabase client for database access (dev mode)')
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
      watches = Array.from(uniqueWatches.values())
    }

    console.log(`[Cron] Found ${watches.length} unique sections to check`)

    if (watches.length === 0) {
      console.log('[Cron] No sections to check')
      return NextResponse.json({
        success: true,
        message: 'No sections to check',
        duration: Date.now() - startTime,
      })
    }

    // Process in batches to balance speed and rate limiting
    const batches = chunk(watches, SCRAPER_BATCH_SIZE)
    const results = {
      total: watches.length,
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
