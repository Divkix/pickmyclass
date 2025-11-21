import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase/service'
import { z } from 'zod'

/**
 * API endpoint for fetching class details from section number and term.
 *
 * Integrates with the scraper service to fetch real-time class data from ASU.
 * Falls back to stub data if scraper is not configured (development mode).
 *
 * Also persists scraped data to class_states table for immediate dashboard display.
 */

/**
 * Validation schema
 */
const fetchClassDetailsSchema = z.object({
  term: z
    .string()
    .regex(/^\d{4}$/, 'Term must be a 4-digit code (e.g., "2261")')
    .min(1, 'Term is required'),
  class_nbr: z
    .string()
    .regex(/^\d{5}$/, 'Section number must be a 5-digit code (e.g., "12431")')
    .min(1, 'Section number is required'),
})

interface FetchClassDetailsResponse {
  subject: string
  catalog_nbr: string
  title: string
  instructor_name?: string | null
  seats_available?: number
  seats_capacity?: number
  location?: string | null
  meeting_times?: string | null
}

interface ScraperResponse {
  success: boolean
  data?: {
    subject: string
    catalog_nbr: string
    title: string
    instructor?: string
    seats_available?: number
    seats_capacity?: number
    non_reserved_seats?: number | null
    location?: string
    meeting_times?: string
  }
  error?: string
}

export async function POST(request: NextRequest) {
  try {
    // Parse and validate request body
    const body = await request.json()
    const validation = fetchClassDetailsSchema.safeParse(body)

    if (!validation.success) {
      return NextResponse.json(
        {
          error: 'Invalid input',
          details: validation.error.issues.map((issue) => ({
            field: issue.path.join('.'),
            message: issue.message,
          })),
        },
        { status: 400 }
      )
    }

    const { term, class_nbr } = validation.data

    // Check if scraper service is configured
    const scraperUrl = process.env.SCRAPER_URL
    const scraperToken = process.env.SCRAPER_SECRET_TOKEN

    if (scraperUrl && scraperToken) {
      // Production mode: Call real scraper service
      try {
        console.log(`[API] Calling scraper service at ${scraperUrl}`)

        const scraperResponse = await fetch(`${scraperUrl}/scrape`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${scraperToken}`,
          },
          body: JSON.stringify({ sectionNumber: class_nbr, term }),
          signal: AbortSignal.timeout(60000), // 60 second timeout
        })

        if (!scraperResponse.ok) {
          const errorText = await scraperResponse.text()
          console.error(`[API] Scraper service error (${scraperResponse.status}): ${errorText}`)
          throw new Error(`Scraper service returned ${scraperResponse.status}`)
        }

        const scraperData = (await scraperResponse.json()) as ScraperResponse

        if (!scraperData.success || !scraperData.data) {
          console.error('[API] Scraper returned unsuccessful response:', scraperData.error)
          throw new Error(scraperData.error || 'Scraper returned no data')
        }

        console.log('[API] Successfully fetched class details from scraper')

        // Persist scraped data to class_states table for immediate dashboard display
        try {
          const supabaseServiceRole = getServiceClient()

          const { error: upsertError } = await supabaseServiceRole
            .from('class_states')
            .upsert(
              {
                term,
                subject: scraperData.data.subject,
                catalog_nbr: scraperData.data.catalog_nbr,
                class_nbr,
                title: scraperData.data.title,
                instructor_name: scraperData.data.instructor || null,
                seats_available: scraperData.data.seats_available || 0,
                seats_capacity: scraperData.data.seats_capacity || 0,
                non_reserved_seats: scraperData.data.non_reserved_seats ?? null,
                location: scraperData.data.location || null,
                meeting_times: scraperData.data.meeting_times || null,
                last_checked_at: new Date().toISOString(),
                last_changed_at: new Date().toISOString(),
              },
              {
                onConflict: 'class_nbr', // Update if class_nbr already exists
              }
            )

          if (upsertError) {
            console.error('[API] Failed to upsert to class_states:', upsertError)
            // Continue anyway - this is not critical for the user's immediate request
          } else {
            console.log('[API] Successfully persisted class state to database')
          }
        } catch (dbError) {
          console.error('[API] Error persisting to database:', dbError)
          // Continue anyway - graceful degradation
        }

        // Return the scraped data
        const response: FetchClassDetailsResponse = {
          subject: scraperData.data.subject,
          catalog_nbr: scraperData.data.catalog_nbr,
          title: scraperData.data.title,
          instructor_name: scraperData.data.instructor,
          seats_available: scraperData.data.seats_available,
          seats_capacity: scraperData.data.seats_capacity,
          location: scraperData.data.location,
          meeting_times: scraperData.data.meeting_times,
        }

        return NextResponse.json(response, { status: 200 })
      } catch (error) {
        // If scraper fails, log and fall through to stub
        console.error('[API] Scraper service failed, falling back to stub:', error)
      }
    } else {
      console.log('[API] Scraper not configured, using stub data (development mode)')
    }

    // Development mode / Fallback: Return stub data
    const stubResponse: FetchClassDetailsResponse = {
      subject: 'CSE',
      catalog_nbr: '240',
      title: 'Introduction to Computer Science',
    }

    // Simulate network delay
    await new Promise((resolve) => setTimeout(resolve, 500))

    return NextResponse.json(stubResponse, { status: 200 })
  } catch (error) {
    console.error('Error fetching class details:', error)
    return NextResponse.json(
      { error: 'Failed to fetch class details' },
      { status: 500 }
    )
  }
}
