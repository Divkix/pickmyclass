import { type NextRequest } from 'next/server';
import { ok, fail } from '@/lib/api/response';
import { withAuth } from '@/lib/api/withAuth';
import { query } from '@/lib/db/client';
import type { ClassStateRow } from '@/lib/db/types';

/**
 * GET /api/class-watches/states?classNumbers=12345,67890
 *
 * Returns the current class_states rows for the authenticated user's watched
 * sections. Replaces the Supabase Realtime subscription — seat data only
 * changes on the 30-min cron, so polling at 60s+ intervals has ~zero freshness
 * loss.
 *
 * Query params:
 *   classNumbers - comma-separated class_nbr values to fetch states for
 *
 * App-layer authz: only returns states for class_nbrs the user actually watches.
 */
export async function GET(request: NextRequest) {
  try {
    return await withAuth(request, async (user) => {
      try {
        const { searchParams } = new URL(request.url);
        const classNumbersParam = searchParams.get('classNumbers') || '';
        const classNumbers = classNumbersParam.split(',').filter(Boolean);

        if (classNumbers.length === 0) {
          return ok({ classStates: [] });
        }

        const states = await query<ClassStateRow>(
          `SELECT cs.id, cs.class_nbr, cs.term, cs.subject, cs.catalog_nbr, cs.title,
                  cs.instructor_name, cs.seats_available, cs.seats_capacity,
                  cs.non_reserved_seats, cs.location, cs.meeting_times,
                  cs.last_checked_at, cs.last_changed_at, cs.consecutive_not_found_count
           FROM class_states cs
           WHERE cs.class_nbr = ANY($1::text[])
             AND cs.class_nbr IN (
               SELECT cw.class_nbr FROM class_watches cw WHERE cw.user_id = $2
             )`,
          [classNumbers, user.userId]
        );

        return ok({ classStates: states });
      } catch {
        return fail('Failed to fetch class states', 500);
      }
    });
  } catch {
    return fail('Failed to fetch class states', 500);
  }
}
