import { and, eq, inArray } from 'drizzle-orm';
import { type NextRequest } from 'next/server';
import { ok, fail } from '@/lib/api/response';
import { withAuth } from '@/lib/api/withAuth';
import { getDbFromEnv } from '@/lib/db';
import { classStates, classWatches } from '@/lib/db/schema';

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

        const db = getDbFromEnv();

        const states = await db
          .select({
            id: classStates.id,
            class_nbr: classStates.class_nbr,
            term: classStates.term,
            subject: classStates.subject,
            catalog_nbr: classStates.catalog_nbr,
            title: classStates.title,
            instructor_name: classStates.instructor_name,
            seats_available: classStates.seats_available,
            seats_capacity: classStates.seats_capacity,
            non_reserved_seats: classStates.non_reserved_seats,
            location: classStates.location,
            meeting_times: classStates.meeting_times,
            last_checked_at: classStates.last_checked_at,
            last_changed_at: classStates.last_changed_at,
            consecutive_not_found_count: classStates.consecutive_not_found_count,
          })
          .from(classStates)
          .where(
            and(
              inArray(classStates.class_nbr, classNumbers),
              // Authz scope: only sections the user actually watches.
              inArray(
                classStates.class_nbr,
                db
                  .select({ class_nbr: classWatches.class_nbr })
                  .from(classWatches)
                  .where(eq(classWatches.user_id, user.userId))
              )
            )
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
