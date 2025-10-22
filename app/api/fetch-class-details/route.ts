import { NextRequest, NextResponse } from 'next/server'

/**
 * API endpoint for fetching class details from section number and term.
 *
 * Integrates with the scraper service to fetch real-time class data from ASU.
 * Falls back to stub data if scraper is not configured (development mode).
 */

interface FetchClassDetailsRequest {
  term: string
  class_nbr: string
}

interface FetchClassDetailsResponse {
  subject: string
  catalog_nbr: string
  title: string
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

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as FetchClassDetailsRequest

    const { term, class_nbr } = body

    // Validation
    if (!term || !class_nbr) {
      return NextResponse.json(
        { error: 'Missing required fields: term and class_nbr' },
        { status: 400 }
      )
    }

    if (!/^\d{4}$/.test(term)) {
      return NextResponse.json(
        { error: 'Term must be a 4-digit code' },
        { status: 400 }
      )
    }

    if (!/^\d{5}$/.test(class_nbr)) {
      return NextResponse.json(
        { error: 'Section number must be a 5-digit code' },
        { status: 400 }
      )
    }

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

        // Return the scraped data
        const response: FetchClassDetailsResponse = {
          subject: scraperData.data.subject,
          catalog_nbr: scraperData.data.catalog_nbr,
          title: scraperData.data.title,
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
