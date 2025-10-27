import { http, HttpResponse } from 'msw'

const RESEND_API_URL = 'https://api.resend.com'

/**
 * Mock Resend API handlers
 */
export const resendHandlers = [
  // POST /emails/batch - send batch emails
  http.post(`${RESEND_API_URL}/emails/batch`, async ({ request }) => {
    const authHeader = request.headers.get('Authorization')

    // Check authentication
    if (!authHeader?.startsWith('Bearer ')) {
      return HttpResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const body = await request.json() as { emails: unknown[] }

    // Return mock batch send results
    return HttpResponse.json({
      data: body.emails.map((_, index) => ({
        id: `mock-email-id-${index}`,
      })),
    })
  }),

  // POST /emails - send single email
  http.post(`${RESEND_API_URL}/emails`, async ({ request }) => {
    const authHeader = request.headers.get('Authorization')

    // Check authentication
    if (!authHeader?.startsWith('Bearer ')) {
      return HttpResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    // Return mock send result
    return HttpResponse.json({
      id: 'mock-email-id',
    })
  }),
]

/**
 * Handler for Resend API error scenario
 */
export const resendErrorHandler = http.post(
  `${RESEND_API_URL}/emails/batch`,
  () => {
    return HttpResponse.json(
      { error: 'Failed to send emails' },
      { status: 500 }
    )
  }
)

/**
 * Handler for Resend API rate limit scenario
 */
export const resendRateLimitHandler = http.post(
  `${RESEND_API_URL}/emails/batch`,
  () => {
    return HttpResponse.json(
      { error: 'Rate limit exceeded' },
      { status: 429 }
    )
  }
)
