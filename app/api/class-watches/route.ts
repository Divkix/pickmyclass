import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { Database } from '@/lib/supabase/database.types'

type ClassState = Database['public']['Tables']['class_states']['Row']

interface CreateClassWatchBody {
  term: string
  subject: string
  catalog_nbr: string
  class_nbr: string
}

/**
 * GET /api/class-watches
 * Fetch all class watches for the authenticated user with joined class_states data
 */
export async function GET() {
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

    return NextResponse.json({ watches: watchesWithStates })
  } catch (error) {
    console.error('Error fetching class watches:', error)
    return NextResponse.json({ error: 'Failed to fetch class watches' }, { status: 500 })
  }
}

/**
 * POST /api/class-watches
 * Create a new class watch for the authenticated user
 * Body: { term, subject, catalog_nbr, class_nbr }
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
    const body = (await request.json()) as CreateClassWatchBody
    const { term, subject, catalog_nbr, class_nbr } = body

    // Validation
    if (!term || !subject || !catalog_nbr || !class_nbr) {
      return NextResponse.json(
        { error: 'Missing required fields: term, subject, catalog_nbr, class_nbr' },
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

    // Insert class watch
    const { data, error } = await supabase
      .from('class_watches')
      .insert({
        user_id: user.id,
        term,
        subject: subject.toUpperCase(), // Normalize to uppercase
        catalog_nbr,
        class_nbr,
      })
      .select()
      .single()

    if (error) {
      // Handle unique constraint violation
      if (error.code === '23505') {
        return NextResponse.json(
          { error: 'You are already watching this class' },
          { status: 409 }
        )
      }
      throw error
    }

    return NextResponse.json({ watch: data }, { status: 201 })
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

    if (!watchId) {
      return NextResponse.json({ error: 'Missing watch ID' }, { status: 400 })
    }

    // Delete the watch (RLS ensures user can only delete their own)
    const { error } = await supabase.from('class_watches').delete().eq('id', watchId).eq('user_id', user.id)

    if (error) throw error

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error deleting class watch:', error)
    return NextResponse.json({ error: 'Failed to delete class watch' }, { status: 500 })
  }
}
