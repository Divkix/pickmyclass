import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { Database } from '@/lib/supabase/database.types'
import {
  checkRateLimit,
  getClientIP,
  createRateLimitResponse,
  addRateLimitHeaders,
  RATE_LIMITS,
} from '@/lib/rate-limit'
import { z } from 'zod'

type ClassState = Database['public']['Tables']['class_states']['Row']

/**
 * Validation schemas
 */
const createClassWatchSchema = z.object({
  term: z
    .string()
    .regex(/^\d{4}$/, 'Term must be a 4-digit code (e.g., "2261")')
    .min(1, 'Term is required'),
  class_nbr: z
    .string()
    .regex(/^\d{5}$/, 'Class number must be a 5-digit code (e.g., "12431")')
    .min(1, 'Class number is required'),
})

const deleteClassWatchSchema = z.object({
  id: z.string().uuid('Watch ID must be a valid UUID'),
})

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

// Get max watches per user from env (default: 10)
const MAX_WATCHES_PER_USER = parseInt(process.env.MAX_WATCHES_PER_USER || '10', 10)

/**
 * GET /api/class-watches
 * Fetch all class watches for the authenticated user with joined class_states data
 */
export async function GET(request: NextRequest) {
  // Rate limiting check
  const clientIP = getClientIP(request)
  const rateLimitResult = checkRateLimit(clientIP, RATE_LIMITS.GET)

  if (!rateLimitResult.allowed) {
    return createRateLimitResponse(
      rateLimitResult.remaining,
      rateLimitResult.resetAt,
      RATE_LIMITS.GET.maxRequests
    )
  }

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
    // Fetch user's class watches
    const { data: watches, error: watchesError } = await supabase
      .from('class_watches')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })

    if (watchesError) throw watchesError

    // Extract class numbers to fetch states
    const classNumbers = watches?.map((w) => w.class_nbr) || []

    // Fetch corresponding class states
    let classStates: ClassState[] = []
    if (classNumbers.length > 0) {
      const { data: states, error: statesError } = await supabase
        .from('class_states')
        .select('*')
        .in('class_nbr', classNumbers)

      if (statesError) throw statesError
      classStates = states || []
    }

    // Create a map of class_nbr -> class_state
    const statesMap = classStates.reduce(
      (acc, state) => {
        acc[state.class_nbr] = state
        return acc
      },
      {} as Record<string, ClassState>
    )

    // Join watches with their states
    const watchesWithStates = watches?.map((watch) => ({
      ...watch,
      class_state: statesMap[watch.class_nbr] || null,
    }))

    const response = NextResponse.json({ watches: watchesWithStates })

    // Add rate limit headers to response
    return addRateLimitHeaders(
      response,
      rateLimitResult.remaining,
      rateLimitResult.resetAt,
      RATE_LIMITS.GET.maxRequests
    )
  } catch (error) {
    console.error('Error fetching class watches:', error)
    return NextResponse.json({ error: 'Failed to fetch class watches' }, { status: 500 })
  }
}

/**
 * POST /api/class-watches
 * Create a new class watch for the authenticated user
 *
 * This endpoint:
 * 1. Calls the scraper service to fetch class details
 * 2. Creates the class watch with scraped data
 * 3. Persists class state to database
 *
 * Body: { term, class_nbr }
 */
export async function POST(request: NextRequest) {
  // Rate limiting check
  const clientIP = getClientIP(request)
  const rateLimitResult = checkRateLimit(clientIP, RATE_LIMITS.POST)

  if (!rateLimitResult.allowed) {
    return createRateLimitResponse(
      rateLimitResult.remaining,
      rateLimitResult.resetAt,
      RATE_LIMITS.POST.maxRequests
    )
  }

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
    // Check max watches per user limit
    const { count: watchCount, error: countError } = await supabase
      .from('class_watches')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id)

    if (countError) {
      console.error('Error counting user watches:', countError)
      throw countError
    }

    if (watchCount !== null && watchCount >= MAX_WATCHES_PER_USER) {
      const response = NextResponse.json(
        {
          error: `Maximum watches limit reached (${MAX_WATCHES_PER_USER}). Delete some watches to add more.`,
        },
        { status: 429 }
      )

      return addRateLimitHeaders(
        response,
        rateLimitResult.remaining,
        rateLimitResult.resetAt,
        RATE_LIMITS.POST.maxRequests
      )
    }

    // Parse and validate request body
    const body = await request.json()
    const validation = createClassWatchSchema.safeParse(body)

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

    // Step 1: Fetch class details from scraper
    console.log(`[API] Fetching class details for section ${class_nbr}, term ${term}`)

    const scraperUrl = process.env.SCRAPER_URL
    const scraperToken = process.env.SCRAPER_SECRET_TOKEN

    let subject: string
    let catalog_nbr: string
    let scrapedData: ScraperResponse['data'] | null = null

    if (scraperUrl && scraperToken) {
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
          console.error(`[API] Scraper service error (${scraperResponse.status}): ${errorText}`)
          throw new Error(`Scraper service returned ${scraperResponse.status}`)
        }

        const scraperData = (await scraperResponse.json()) as ScraperResponse

        if (!scraperData.success || !scraperData.data) {
          console.error('[API] Scraper returned unsuccessful response:', scraperData.error)
          throw new Error(scraperData.error || 'Scraper returned no data')
        }

        console.log('[API] Successfully fetched class details from scraper')
        scrapedData = scraperData.data
        subject = scraperData.data.subject
        catalog_nbr = scraperData.data.catalog_nbr
      } catch (error) {
        console.error('[API] Failed to fetch from scraper:', error)
        return NextResponse.json(
          { error: 'Failed to fetch class details. Please verify the section number and try again.' },
          { status: 500 }
        )
      }
    } else {
      // Development fallback
      console.log('[API] Scraper not configured, using stub data')
      subject = 'CSE'
      catalog_nbr = '240'
    }

    // Step 2: Create class watch
    const { data: watchData, error: insertError } = await supabase
      .from('class_watches')
      .insert({
        user_id: user.id,
        term,
        subject: subject.toUpperCase(),
        catalog_nbr,
        class_nbr,
      })
      .select()
      .single()

    if (insertError) {
      // Handle unique constraint violation
      if (insertError.code === '23505') {
        return NextResponse.json(
          { error: 'You are already watching this class' },
          { status: 409 }
        )
      }
      throw insertError
    }

    console.log('[API] Successfully created class watch')

    // Step 3: Persist class state if we have scraped data
    if (scrapedData) {
      try {
        const supabaseServiceRole = createServiceRoleClient()

        const { error: upsertError } = await supabaseServiceRole
          .from('class_states')
          .upsert(
            {
              term,
              subject: scrapedData.subject,
              catalog_nbr: scrapedData.catalog_nbr,
              class_nbr,
              title: scrapedData.title,
              instructor_name: scrapedData.instructor || null,
              seats_available: scrapedData.seats_available || 0,
              seats_capacity: scrapedData.seats_capacity || 0,
              location: scrapedData.location || null,
              meeting_times: scrapedData.meeting_times || null,
              last_checked_at: new Date().toISOString(),
              last_changed_at: new Date().toISOString(),
            },
            {
              onConflict: 'class_nbr',
            }
          )

        if (upsertError) {
          console.error('[API] Failed to upsert class state:', upsertError)
          // Continue anyway - watch was created successfully
        } else {
          console.log('[API] Successfully persisted class state to database')
        }
      } catch (dbError) {
        console.error('[API] Error persisting to database:', dbError)
        // Continue anyway - watch was created successfully
      }
    }

    const response = NextResponse.json({ watch: watchData }, { status: 201 })

    return addRateLimitHeaders(
      response,
      rateLimitResult.remaining,
      rateLimitResult.resetAt,
      RATE_LIMITS.POST.maxRequests
    )
  } catch (error) {
    console.error('Error creating class watch:', error)
    return NextResponse.json({ error: 'Failed to create class watch' }, { status: 500 })
  }
}

/**
 * DELETE /api/class-watches?id=<watch_id>
 * Delete a class watch for the authenticated user
 */
export async function DELETE(request: NextRequest) {
  // Rate limiting check
  const clientIP = getClientIP(request)
  const rateLimitResult = checkRateLimit(clientIP, RATE_LIMITS.DELETE)

  if (!rateLimitResult.allowed) {
    return createRateLimitResponse(
      rateLimitResult.remaining,
      rateLimitResult.resetAt,
      RATE_LIMITS.DELETE.maxRequests
    )
  }

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
    const { searchParams } = new URL(request.url)
    const watchId = searchParams.get('id')

    // Validate watch ID
    const validation = deleteClassWatchSchema.safeParse({ id: watchId })

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

    // Delete the watch (RLS ensures user can only delete their own)
    const { error } = await supabase.from('class_watches').delete().eq('id', validation.data.id).eq('user_id', user.id)

    if (error) throw error

    const response = NextResponse.json({ success: true })

    return addRateLimitHeaders(
      response,
      rateLimitResult.remaining,
      rateLimitResult.resetAt,
      RATE_LIMITS.DELETE.maxRequests
    )
  } catch (error) {
    console.error('Error deleting class watch:', error)
    return NextResponse.json({ error: 'Failed to delete class watch' }, { status: 500 })
  }
}
