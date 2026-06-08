import { env } from 'cloudflare:workers';
import { type NextRequest, NextResponse } from 'next/server';
import { createClassWatchSchema, deleteClassWatchSchema } from '@/lib/api/schemas';
import { mapValidationIssues } from '@/lib/api/validation';
import { AuthError, type ClassDetails, fetchClassFromASU, NotFoundError } from '@/lib/asu/api';
import { createClient } from '@/lib/supabase/server';
import { getServiceClient } from '@/lib/supabase/service';
import type { ClassStateRow, ClassWatchRow } from '@/lib/types/class-watch';

// Get max watches per user from env (default: 10)
const MAX_WATCHES_PER_USER = parseInt(process.env.MAX_WATCHES_PER_USER || '10', 10);

/**
 * GET /api/class-watches
 * Fetch all class watches for the authenticated user with joined class_states data
 */
export async function GET() {
  const supabase = await createClient();

  // Check authentication
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { data: watches, error: watchesError } = await supabase
      .from('class_watches')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    if (watchesError) throw watchesError;

    const classNumbers = watches?.map((w) => w.class_nbr) || [];

    let classStates: ClassStateRow[] = [];
    if (classNumbers.length > 0) {
      const { data: states, error: statesError } = await supabase
        .from('class_states')
        .select('*')
        .in('class_nbr', classNumbers);

      if (statesError) throw statesError;
      classStates = states || [];
    }

    const statesMap = classStates.reduce(
      (acc, state) => {
        acc[state.class_nbr] = state;
        return acc;
      },
      {} as Record<string, ClassStateRow>
    );

    const watchesWithStates = watches?.map((watch) => ({
      ...watch,
      class_state: statesMap[watch.class_nbr] || null,
    }));

    return NextResponse.json({
      watches: watchesWithStates,
      maxWatches: MAX_WATCHES_PER_USER,
    });
  } catch (error) {
    console.error('Error fetching class watches:', error);

    return NextResponse.json({ error: 'Failed to fetch class watches' }, { status: 500 });
  }
}

/**
 * POST /api/class-watches
 * Create a new class watch for the authenticated user
 *
 * This endpoint:
 * 1. Fetches class details from ASU API
 * 2. Creates the class watch with fetched data
 * 3. Persists class state to database
 *
 * Body: { term, class_nbr }
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();

  // Check authentication
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { count: watchCount, error: countError } = await supabase
      .from('class_watches')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id);

    if (countError) {
      console.error('Error counting user watches:', countError);

      throw countError;
    }

    if (watchCount !== null && watchCount >= MAX_WATCHES_PER_USER) {
      return NextResponse.json(
        {
          error: `Maximum watches limit reached (${MAX_WATCHES_PER_USER}). Delete some watches to add more.`,
        },
        { status: 429 }
      );
    }

    const body = await request.json();
    const validation = createClassWatchSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json(
        {
          error: 'Invalid input',
          details: mapValidationIssues(validation.error),
        },
        { status: 400 }
      );
    }

    const { term, class_nbr } = validation.data;

    // Step 1: Fetch class details from ASU API
    console.log(`[API] Fetching class details for section ${class_nbr}, term ${term}`);

    // Get ASU API env vars (Cloudflare secrets)
    const asuEnv = env as unknown as { ASU_API_BASE_URL: string; ASU_API_TOKEN: string };

    let classDetails: ClassDetails;
    try {
      classDetails = await fetchClassFromASU(class_nbr, term, asuEnv);
    } catch (error) {
      if (error instanceof NotFoundError) {
        return NextResponse.json({ error: 'Class section not found' }, { status: 404 });
      }
      if (error instanceof AuthError) {
        console.error('ASU API auth error:', error instanceof Error ? error.message : error);
        return NextResponse.json({ error: 'Service temporarily unavailable' }, { status: 503 });
      }
      console.error('Failed to fetch class details:', error);
      return NextResponse.json({ error: 'Failed to fetch class details' }, { status: 500 });
    }

    console.log('[API] Successfully fetched class details from ASU API');

    // Use service role for atomic insert RPC so clients cannot bypass limit checks by calling it directly.
    const supabaseServiceRole = getServiceClient();

    // Step 2: Create class watch atomically (prevents concurrent limit bypass).
    // oxlint-disable-next-line typescript/unbound-method
    const createClassWatchWithLimit = supabaseServiceRole.rpc as unknown as (
      fn: string,
      args: {
        p_user_id: string;
        p_term: string;
        p_subject: string;
        p_catalog_nbr: string;
        p_class_nbr: string;
        p_max_watches: number;
      }
    ) => Promise<{
      data: ClassWatchRow | null;
      error: { code?: string; message?: string } | null;
    }>;

    const { data: watchDataRaw, error: insertError } = await createClassWatchWithLimit(
      'create_class_watch_with_limit',
      {
        p_user_id: user.id,
        p_term: term,
        p_subject: classDetails.subject.toUpperCase(),
        p_catalog_nbr: classDetails.catalog_nbr,
        p_class_nbr: class_nbr,
        p_max_watches: MAX_WATCHES_PER_USER,
      }
    );

    if (insertError) {
      // Handle unique constraint violation
      if (insertError.code === '23505') {
        return NextResponse.json({ error: 'You are already watching this class' }, { status: 409 });
      }

      // Handle atomic limit-enforcement function error.
      if (
        insertError.code === 'P0001' &&
        typeof insertError.message === 'string' &&
        insertError.message.includes('MAX_WATCHES_EXCEEDED')
      ) {
        return NextResponse.json(
          {
            error: `Maximum watches limit reached (${MAX_WATCHES_PER_USER}). Delete some watches to add more.`,
          },
          { status: 429 }
        );
      }

      throw insertError;
    }

    if (!watchDataRaw) {
      throw new Error('Failed to create class watch');
    }

    console.log('[API] Successfully created class watch');

    // Step 3: Persist class state
    try {
      const { error: upsertError } = await supabaseServiceRole.from('class_states').upsert(
        {
          term,
          subject: classDetails.subject,
          catalog_nbr: classDetails.catalog_nbr,
          class_nbr,
          title: classDetails.title,
          instructor_name: classDetails.instructor || null,
          seats_available: classDetails.seats_available,
          seats_capacity: classDetails.seats_capacity,
          non_reserved_seats: classDetails.non_reserved_seats ?? null,
          location: classDetails.location || null,
          meeting_times: classDetails.meeting_times || null,
          last_checked_at: new Date().toISOString(),
        },
        {
          onConflict: 'class_nbr',
        }
      );

      if (upsertError) {
        console.error('[API] Failed to upsert class state:', upsertError);
        // Continue anyway - watch was created successfully
      } else {
        console.log('[API] Successfully persisted class state to database');
      }
    } catch (dbError) {
      console.error('[API] Error persisting to database:', dbError);
      // Continue anyway - watch was created successfully
    }

    return NextResponse.json({ watch: watchDataRaw }, { status: 201 });
  } catch (error) {
    console.error('Error creating class watch:', error);

    return NextResponse.json({ error: 'Failed to create class watch' }, { status: 500 });
  }
}

/**
 * DELETE /api/class-watches?id=<watch_id>
 * Delete a class watch for the authenticated user
 */
export async function DELETE(request: NextRequest) {
  const supabase = await createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const watchId = searchParams.get('id');

    // Validate watch ID
    const validation = deleteClassWatchSchema.safeParse({ id: watchId });

    if (!validation.success) {
      return NextResponse.json(
        {
          error: 'Invalid input',
          details: mapValidationIssues(validation.error),
        },
        { status: 400 }
      );
    }

    // Delete the watch (RLS ensures user can only delete their own)
    const { error } = await supabase
      .from('class_watches')
      .delete()
      .eq('id', validation.data.id)
      .eq('user_id', user.id);

    if (error) {
      throw error;
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting class watch:', error);

    return NextResponse.json({ error: 'Failed to delete class watch' }, { status: 500 });
  }
}
