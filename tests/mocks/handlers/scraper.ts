import { http, HttpResponse } from 'msw'

const SCRAPER_URL = 'http://localhost:3000'

/**
 * Mock scraper API handlers
 */
export const scraperHandlers = [
  // POST /scrape - scrape class section
  http.post(`${SCRAPER_URL}/scrape`, async ({ request }) => {
    const authHeader = request.headers.get('Authorization')

    // Check authentication
    if (authHeader !== 'Bearer test-scraper-token') {
      return HttpResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const body = await request.json() as { sectionNumber: string; term: string }

    // Return mock class data
    return HttpResponse.json({
      success: true,
      data: {
        classNbr: body.sectionNumber,
        subject: 'CSE',
        catalogNbr: '110',
        title: 'Principles of Programming',
        instructorName: 'John Smith',
        seatsAvailable: 5,
        seatsCapacity: 150,
        location: 'BYENG M1-14',
        meetingTimes: 'MW 10:30 AM - 11:45 AM',
      },
    })
  }),

  // GET /status - health check
  http.get(`${SCRAPER_URL}/status`, () => {
    return HttpResponse.json({
      status: 'healthy',
      browserPool: {
        total: 5,
        available: 3,
        busy: 2,
        queued: 0,
      },
    })
  }),
]

/**
 * Handler for scraper timeout scenario
 */
export const scraperTimeoutHandler = http.post(
  `${SCRAPER_URL}/scrape`,
  async () => {
    // Simulate timeout
    await new Promise(resolve => setTimeout(resolve, 50000))
    return HttpResponse.json({ error: 'Timeout' }, { status: 504 })
  }
)

/**
 * Handler for scraper error scenario
 */
export const scraperErrorHandler = http.post(
  `${SCRAPER_URL}/scrape`,
  () => {
    return HttpResponse.json(
      { error: 'Internal scraper error' },
      { status: 500 }
    )
  }
)

/**
 * Handler for staff instructor (no seat data)
 */
export const scraperStaffHandler = http.post(
  `${SCRAPER_URL}/scrape`,
  async ({ request }) => {
    const body = await request.json() as { sectionNumber: string; term: string }

    return HttpResponse.json({
      success: true,
      data: {
        classNbr: body.sectionNumber,
        subject: 'CSE',
        catalogNbr: '110',
        title: 'Principles of Programming',
        instructorName: 'Staff',
        seatsAvailable: 0,
        seatsCapacity: 150,
        location: 'BYENG M1-14',
        meetingTimes: 'MW 10:30 AM - 11:45 AM',
      },
    })
  }
)
