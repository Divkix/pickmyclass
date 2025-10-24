import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

interface RefreshClassWatchBody {
  term: string
  class_nbr: string
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
    location?: string
    meeting_times?: string
  }
  error?: string
}

/**
 * POST /api/class-watches/refresh
 * Refresh class details for an existing watch
 *
 * This endpoint:
 * 1. Verifies user owns a watch for the specified class
 * 2. Calls the scraper service to fetch fresh class details
 * 3. Updates the class_states table
 * 4. Returns the updated class state
 *
 * Body: { term, class_nbr }
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient()

  // Check authentication
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = (await request.json()) as RefreshClassWatchBody
    const { term, class_nbr } = body

    // Validation
    if (!term || !class_nbr) {
      return NextResponse.json(
        { error: 'Missing required fields: term, class_nbr' },
        { status: 400 }
      )
    }

    // Validate section number format (ASU uses 5-digit numbers)
    if (!/^\d{5}$/.test(class_nbr)) {
      return NextResponse.json(
        { error: 'Invalid section number. Must be 5 digits (e.g., "12431")' },
        { status: 400 }
      )
    }

    // Validate term format (e.g., "2261")
    if (!/^\d{4}$/.test(term)) {
      return NextResponse.json(
        { error: 'Invalid term format. Must be 4 digits (e.g., "2261")' },
        { status: 400 }
      )
    }

    // Verify user owns a watch for this class
    const { data: watch, error: watchError } = await supabase
      .from('class_watches')
      .select('id')
      .eq('user_id', user.id)
      .eq('class_nbr', class_nbr)
      .eq('term', term)
      .single()

    if (watchError || !watch) {
      return NextResponse.json(
        { error: 'Watch not found. You can only refresh classes you are watching.' },
        { status: 404 }
      )
    }

    // Fetch class details from scraper
    console.log(`[Refresh API] Fetching class details for section ${class_nbr}, term ${term}`)

    const scraperUrl = process.env.SCRAPER_URL
    const scraperToken = process.env.SCRAPER_SECRET_TOKEN

    if (!scraperUrl || !scraperToken) {
      return NextResponse.json(
        { error: 'Scraper service not configured' },
        { status: 503 }
      )
    }

    try {
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
        console.error(`[Refresh API] Scraper service error (${scraperResponse.status}): ${errorText}`)
        throw new Error(`Scraper service returned ${scraperResponse.status}`)
      }

      const scraperData = (await scraperResponse.json()) as ScraperResponse

      if (!scraperData.success || !scraperData.data) {
        console.error('[Refresh API] Scraper returned unsuccessful response:', scraperData.error)
        throw new Error(scraperData.error || 'Scraper returned no data')
      }

      console.log('[Refresh API] Successfully fetched class details from scraper')

      // Update class_states table using service role client
      const supabaseServiceRole = createServiceRoleClient()

      const { data: classState, error: upsertError } = await supabaseServiceRole
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
            location: scraperData.data.location || null,
            meeting_times: scraperData.data.meeting_times || null,
            last_checked_at: new Date().toISOString(),
            last_changed_at: new Date().toISOString(),
          },
          {
            onConflict: 'class_nbr',
          }
        )
        .select()
        .single()

      if (upsertError) {
        console.error('[Refresh API] Failed to upsert class state:', upsertError)
        throw upsertError
      }

      console.log('[Refresh API] Successfully updated class state in database')

      return NextResponse.json({ success: true, classState }, { status: 200 })
    } catch (error) {
      console.error('[Refresh API] Failed to fetch from scraper:', error)
      return NextResponse.json(
        { error: 'Failed to fetch class details. Please verify the section number and try again.' },
        { status: 500 }
      )
    }
  } catch (error) {
    console.error('Error refreshing class watch:', error)
    return NextResponse.json({ error: 'Failed to refresh class watch' }, { status: 500 })
  }
}
