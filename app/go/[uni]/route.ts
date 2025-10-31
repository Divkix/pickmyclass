/**
 * University Class Redirect Service
 *
 * Redirects to university class catalog pages from internal short links.
 * This solves email deliverability issues where direct external links trigger spam filters.
 *
 * Usage: /go/asu?classNbr=29941&term=2261
 */

import { NextRequest, NextResponse } from 'next/server'

/**
 * GET /go/[uni]?classNbr=X&term=Y
 *
 * Redirects to the university's class catalog page for the specified section.
 *
 * @param request - Next.js request object
 * @param params - Dynamic route parameters (uni)
 * @returns 302 redirect to university catalog or error response
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { uni: string } }
) {
  const { uni } = params
  const { searchParams } = new URL(request.url)
  const classNbr = searchParams.get('classNbr')
  const term = searchParams.get('term')

  // Validate required parameters
  if (!classNbr || !term) {
    return NextResponse.json(
      {
        error: 'Missing required parameters',
        message: 'Both classNbr and term are required',
        example: '/go/asu?classNbr=29941&term=2261',
      },
      { status: 400 }
    )
  }

  // Route to appropriate university
  switch (uni.toLowerCase()) {
    case 'asu':
      return redirectToASU(classNbr, term)

    default:
      return NextResponse.json(
        {
          error: 'University not supported',
          message: `University "${uni}" is not currently supported`,
          supported: ['asu'],
        },
        { status: 404 }
      )
  }
}

/**
 * Redirect to ASU Class Search catalog
 *
 * @param classNbr - Section number (e.g., "29941")
 * @param term - Academic term (e.g., "2261")
 * @returns 302 redirect response
 */
function redirectToASU(classNbr: string, term: string): NextResponse {
  // Sanitize inputs (allow only digits to prevent injection)
  const safeClassNbr = classNbr.replace(/[^0-9]/g, '')
  const safeTerm = term.replace(/[^0-9]/g, '')

  // Build ASU catalog URL
  const asuUrl = `https://catalog.apps.asu.edu/catalog/classes/classlist?keywords=${safeClassNbr}&term=${safeTerm}`

  // Optional: Track click analytics here in the future
  // Example: logRedirectClick({ uni: 'asu', classNbr, term, timestamp: Date.now() })

  // Return 302 temporary redirect
  return NextResponse.redirect(asuUrl, 302)
}
