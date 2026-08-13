import { env } from 'cloudflare:workers';
import { type NextRequest } from 'next/server';
import { ok, fail } from '@/lib/api/response';
import { fetchClassDetailsSchema } from '@/lib/api/schemas';
import { mapAsuErrorToResponse } from '@/lib/api/asu-response';
import { mapValidationIssues } from '@/lib/api/validation';
import { type ClassDetails, fetchClassFromASU } from '@/lib/asu/api';
import { requireUser, UnauthorizedError } from '@/lib/auth/require-user';
import { upsertClassState } from '@/lib/db/queries';
import { log } from '@/lib/log';
import { createClient } from '@/lib/supabase/server';
import { getServiceClient } from '@/lib/supabase/service';
import type { FetchClassDetailsResponse } from '@/lib/types/class';

/**
 * API endpoint for fetching class details from section number and term.
 *
 * Integrates with the ASU Class Search API to fetch real-time class data.
 * Persists fetched data to class_states table for immediate dashboard display.
 */

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const validation = fetchClassDetailsSchema.safeParse(body);

    if (!validation.success) {
      return fail('Invalid input', 400, mapValidationIssues(validation.error));
    }

    const { term, class_nbr } = validation.data;

    const supabase = await createClient();
    await requireUser(supabase);

    // SAFETY: ASU API credentials are required Cloudflare secrets validated at deploy time; shape matches wrangler.jsonc env contract.
    const asuEnv = env as { ASU_API_BASE_URL: string; ASU_API_TOKEN: string };

    let classDetails: ClassDetails;

    try {
      classDetails = await fetchClassFromASU({ class_nbr, term }, asuEnv);
    } catch (error) {
      return mapAsuErrorToResponse(error);
    }

    // Persist fetched data to class_states table for immediate dashboard display
    try {
      await upsertClassState(getServiceClient(), { class_nbr, term }, classDetails);
    } catch (dbError) {
      log('API').error('Failed to persist class state:', dbError);
      // Continue anyway - graceful degradation
    }

    // Return the fetched data
    const response: FetchClassDetailsResponse = {
      subject: classDetails.subject,
      catalog_nbr: classDetails.catalog_nbr,
      title: classDetails.title,
      instructor_name: classDetails.instructor_name,
      seats_available: classDetails.seats_available,
      seats_capacity: classDetails.seats_capacity,
      location: classDetails.location,
      meeting_times: classDetails.meeting_times,
    };

    return ok(response);
  } catch (error) {
    if (error instanceof UnauthorizedError) return fail('Unauthorized', 401);
    log('API').error('Error fetching class details:', error);
    return fail('Failed to fetch class details', 500);
  }
}
