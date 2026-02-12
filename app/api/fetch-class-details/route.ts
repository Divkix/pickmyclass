import { getCloudflareContext } from '@opennextjs/cloudflare';
import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { AuthError, type ClassDetails, fetchClassFromASU, NotFoundError } from '@/lib/asu/api';
import { getServiceClient } from '@/lib/supabase/service';

/**
 * API endpoint for fetching class details from section number and term.
 *
 * Integrates with the ASU Class Search API to fetch real-time class data.
 * Persists fetched data to class_states table for immediate dashboard display.
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
});

interface FetchClassDetailsResponse {
  subject: string;
  catalog_nbr: string;
  title: string;
  instructor_name?: string | null;
  seats_available?: number;
  seats_capacity?: number;
  location?: string | null;
  meeting_times?: string | null;
}

export async function POST(request: NextRequest) {
  try {
    // Parse and validate request body
    const body = await request.json();
    const validation = fetchClassDetailsSchema.safeParse(body);

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
      );
    }

    const { term, class_nbr } = validation.data;

    // Get Cloudflare context for ASU API env vars
    // ASU_API_BASE_URL and ASU_API_TOKEN are set as Cloudflare secrets
    const { env } = await getCloudflareContext();
    const asuEnv = env as unknown as { ASU_API_BASE_URL: string; ASU_API_TOKEN: string };

    let classDetails: ClassDetails;

    try {
      classDetails = await fetchClassFromASU(class_nbr, term, asuEnv);
    } catch (error) {
      if (error instanceof NotFoundError) {
        return NextResponse.json({ error: 'Class section not found' }, { status: 404 });
      }
      if (error instanceof AuthError) {
        console.error('ASU API auth error:', error.message);
        return NextResponse.json({ error: 'Service temporarily unavailable' }, { status: 503 });
      }
      console.error('Failed to fetch class details:', error);
      return NextResponse.json({ error: 'Failed to fetch class details' }, { status: 500 });
    }

    // Persist fetched data to class_states table for immediate dashboard display
    try {
      const supabaseServiceRole = getServiceClient();

      const { error: upsertError } = await supabaseServiceRole.from('class_states').upsert(
        {
          term,
          subject: classDetails.subject,
          catalog_nbr: classDetails.catalog_nbr,
          class_nbr,
          title: classDetails.title,
          instructor_name: classDetails.instructor || null,
          seats_available: classDetails.seats_available || 0,
          seats_capacity: classDetails.seats_capacity || 0,
          non_reserved_seats: classDetails.non_reserved_seats ?? null,
          location: classDetails.location || null,
          meeting_times: classDetails.meeting_times || null,
          last_checked_at: new Date().toISOString(),
          last_changed_at: new Date().toISOString(),
        },
        {
          onConflict: 'class_nbr',
        }
      );

      if (upsertError) {
        console.error('[API] Failed to upsert to class_states:', upsertError);
      } else {
        console.log('[API] Successfully persisted class state to database');
      }
    } catch (dbError) {
      console.error('[API] Error persisting to database:', dbError);
      // Continue anyway - graceful degradation
    }

    // Return the fetched data
    const response: FetchClassDetailsResponse = {
      subject: classDetails.subject,
      catalog_nbr: classDetails.catalog_nbr,
      title: classDetails.title,
      instructor_name: classDetails.instructor,
      seats_available: classDetails.seats_available,
      seats_capacity: classDetails.seats_capacity,
      location: classDetails.location,
      meeting_times: classDetails.meeting_times,
    };

    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    console.error('Error fetching class details:', error);
    return NextResponse.json({ error: 'Failed to fetch class details' }, { status: 500 });
  }
}
