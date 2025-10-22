import { NextRequest, NextResponse } from 'next/server'

/**
 * Stub API endpoint for fetching class details from section number and term.
 *
 * TODO: Implement actual scraping logic when the scraper service is ready.
 * This endpoint should:
 * 1. Accept term and class_nbr (section number)
 * 2. Query the ASU class search API/scraper for that section
 * 3. Return the subject, catalog_nbr, and title
 *
 * For now, returns placeholder data to enable frontend development.
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

    // TODO: Replace this stub logic with actual API call to scraper service
    // Example implementation:
    // const response = await fetch('https://scraper.yourdomain.com/scrape', {
    //   method: 'POST',
    //   headers: {
    //     'Content-Type': 'application/json',
    //     'Authorization': `Bearer ${process.env.SCRAPER_SECRET_TOKEN}`,
    //   },
    //   body: JSON.stringify({ sectionNumber: class_nbr, term }),
    // })
    // const data = await response.json()
    // return NextResponse.json({
    //   subject: data.subject,
    //   catalog_nbr: data.catalog_nbr,
    //   title: data.title,
    // })

    // Stub response with placeholder data
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
