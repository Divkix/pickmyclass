import { env } from 'cloudflare:workers';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { type NextRequest } from 'next/server';
import { ok, fail } from '@/lib/api/response';
import { withAuth } from '@/lib/api/withAuth';
import { createClassWatchSchema, deleteClassWatchSchema } from '@/lib/api/schemas';
import { parseOrFail } from '@/lib/api/validation';
import { AuthError, type ClassDetails, fetchClassFromASU, NotFoundError } from '@/lib/asu/api';
import { getDbFromEnv } from '@/lib/db';
import { getPgError, isUniqueViolation, PG_RAISE_EXCEPTION } from '@/lib/db/pg-errors';
import { upsertClassState } from '@/lib/db/queries';
import { classStates, classWatches } from '@/lib/db/schema';
import { log } from '@/lib/log';
import { captureServerEvent } from '@/lib/analytics/server';
import type { ClassStateRow, ClassWatchRow } from '@/lib/types/class-watch';
import { applyFirstWatchGuard, readOnboardingState, toOnboardingState } from '@/lib/onboarding';

// Get max watches per user from env (default: 10)
const MAX_WATCHES_PER_USER = parseInt(process.env.MAX_WATCHES_PER_USER || '10', 10);

/** Projected `class_states` fields joined onto each watch in the dashboard list. */
type WatchClassState = Pick<
  ClassStateRow,
  | 'class_nbr'
  | 'term'
  | 'seats_available'
  | 'seats_capacity'
  | 'non_reserved_seats'
  | 'instructor_name'
  | 'title'
>;

/**
 * GET /api/class-watches
 * Fetch all class watches for the authenticated user with joined class_states data
 */
export async function GET(request: NextRequest) {
  try {
    return await withAuth(request, async (user) => {
      // One request-scoped handle shared by every read below.
      const db = getDbFromEnv();

      try {
        const watches = await db
          .select({
            id: classWatches.id,
            class_nbr: classWatches.class_nbr,
            term: classWatches.term,
            subject: classWatches.subject,
            catalog_nbr: classWatches.catalog_nbr,
            created_at: classWatches.created_at,
          })
          .from(classWatches)
          .where(eq(classWatches.user_id, user.userId))
          .orderBy(desc(classWatches.created_at));

        const classNumbers = watches.map((w) => w.class_nbr);
        const terms = Array.from(new Set(watches.map((w) => w.term)));

        // Fetch class states for the user's watches — scoped by both class_nbr AND term
        // so a section number watched in two terms keeps separate states.
        const joinedStates: WatchClassState[] =
          classNumbers.length > 0
            ? await db
                .select({
                  class_nbr: classStates.class_nbr,
                  term: classStates.term,
                  seats_available: classStates.seats_available,
                  seats_capacity: classStates.seats_capacity,
                  non_reserved_seats: classStates.non_reserved_seats,
                  instructor_name: classStates.instructor_name,
                  title: classStates.title,
                })
                .from(classStates)
                .where(
                  and(
                    inArray(classStates.class_nbr, classNumbers),
                    inArray(classStates.term, terms)
                  )
                )
            : [];

        // Expose onboarding state so the dashboard can render the first-time modal
        // / finish-setup card without an extra round trip. The auxiliary read is
        // isolated: a failure logs and projects the module fallback ("not needed")
        // rather than failing the whole watches fetch.
        const onboarding = await readOnboardingState(db, user.userId).catch((error) => {
          log('API').error('Failed to read onboarding state:', error);
          return toOnboardingState(null);
        });

        const statesMap = joinedStates.reduce(
          (acc, state) => {
            acc[`${state.term}:${state.class_nbr}`] = state;
            return acc;
          },
          // SAFETY: empty object is the initial typed accumulator for the keyed map
          {} as Record<string, WatchClassState>
        );

        const watchesWithStates = watches.map((watch) => ({
          ...watch,
          class_state: statesMap[`${watch.term}:${watch.class_nbr}`] || null,
        }));

        return ok({
          watches: watchesWithStates,
          maxWatches: MAX_WATCHES_PER_USER,
          onboarding,
        });
      } catch (error) {
        log('API').error('Error fetching class watches:', error);
        return fail('Failed to fetch class watches', 500);
      }
    });
  } catch (error) {
    log('API').error('Error fetching class watches:', error);
    return fail('Failed to fetch class watches', 500);
  }
}

/**
 * POST /api/class-watches
 * Create a new class watch for the authenticated user
 */
export async function POST(request: NextRequest) {
  try {
    return await withAuth(request, async (user) => {
      try {
        const body = await request.json();
        const parsed = parseOrFail(createClassWatchSchema, body);

        if (!parsed.success) {
          return parsed.response;
        }

        const { term, class_nbr } = parsed.data;
        // SAFETY: env is Cloudflare Workers bindings; ASU_API_BASE_URL and ASU_API_TOKEN are required secrets validated at deploy
        const asuEnv = env as { ASU_API_BASE_URL: string; ASU_API_TOKEN: string };
        let classDetails: ClassDetails;
        try {
          classDetails = await fetchClassFromASU({ class_nbr, term }, asuEnv);
        } catch (error) {
          if (error instanceof NotFoundError) {
            return fail('Class section not found', 404);
          }
          if (error instanceof AuthError) {
            log('API').error('ASU API auth error:', error instanceof Error ? error.message : error);
            return fail('Service temporarily unavailable', 503);
          }
          log('API').error('Failed to fetch class details:', error);
          return fail('Failed to fetch class details', 500);
        }

        // One request-scoped handle shared by the RPC, the state upsert, and the
        // first-watch guard below.
        const db = getDbFromEnv();

        // Step 2: Create class watch atomically (prevents concurrent limit bypass).
        // The SECURITY DEFINER RPC enforces the watch limit via an advisory lock;
        // bound parameters carry explicit PostgreSQL casts.
        let watchDataRaw: ClassWatchRow | null = null;
        try {
          const rows = await db.execute<ClassWatchRow>(
            sql`SELECT * FROM public.create_class_watch_with_limit(
              ${user.userId}::text,
              ${term}::text,
              ${classDetails.subject.toUpperCase()}::text,
              ${classDetails.catalog_nbr}::text,
              ${class_nbr}::text,
              ${MAX_WATCHES_PER_USER}::int
            )`
          );
          watchDataRaw = rows[0] ?? null;
        } catch (insertError) {
          // Handle unique constraint violation.
          if (isUniqueViolation(insertError)) {
            return fail('You are already watching this class', 409);
          }

          // Handle atomic limit-enforcement function error (RAISE EXCEPTION).
          const pgError = getPgError(insertError);
          if (
            pgError?.code === PG_RAISE_EXCEPTION &&
            typeof pgError.message === 'string' &&
            pgError.message.includes('MAX_WATCHES_EXCEEDED')
          ) {
            return fail(
              `Maximum watches limit reached (${MAX_WATCHES_PER_USER}). Delete some watches to add more.`,
              429
            );
          }

          throw insertError;
        }

        if (!watchDataRaw) {
          throw new Error('Failed to create class watch');
        }

        // Step 3: Persist class state
        try {
          await upsertClassState(db, { class_nbr, term }, classDetails);
        } catch (dbError) {
          log('API').error('Failed to persist class state:', dbError);
          // Continue anyway - watch was created successfully
        }

        // Step 4: Mark onboarding complete on the user's first class watch so the
        // finish-setup card stops reappearing. The guard only checks
        // `onboarding_completed_at IS NULL`, so a user who skipped onboarding
        // still transitions to completed on their first watch (ADR 0010).
        try {
          await applyFirstWatchGuard(db, user.userId);
        } catch (dbError) {
          log('API').error('Failed to mark onboarding complete:', dbError);
          // Non-fatal - watch was created successfully
        }

        captureServerEvent(user.userId, 'class_watch_created', { term, class_nbr });

        return ok({ watch: watchDataRaw }, { status: 201 });
      } catch (error) {
        log('API').error('Error creating class watch:', error);
        return fail('Failed to create class watch', 500);
      }
    });
  } catch (error) {
    log('API').error('Error creating class watch:', error);
    return fail('Failed to create class watch', 500);
  }
}

/**
 * DELETE /api/class-watches?id=<watch_id>
 * Delete a class watch for the authenticated user
 */
export async function DELETE(request: NextRequest) {
  try {
    return await withAuth(request, async (user) => {
      try {
        const { searchParams } = new URL(request.url);
        const watchId = searchParams.get('id');

        // Validate watch ID
        const parsed = parseOrFail(deleteClassWatchSchema, { id: watchId });

        if (!parsed.success) {
          return parsed.response;
        }

        const db = getDbFromEnv();

        // Delete the watch — app-layer authz ensures user can only delete their own
        await db
          .delete(classWatches)
          .where(and(eq(classWatches.id, parsed.data.id), eq(classWatches.user_id, user.userId)));

        captureServerEvent(user.userId, 'class_watch_deleted', {
          watch_id: parsed.data.id,
        });

        return ok(undefined);
      } catch (error) {
        log('API').error('Error deleting class watch:', error);
        return fail('Failed to delete class watch', 500);
      }
    });
  } catch (error) {
    log('API').error('Error deleting class watch:', error);
    return fail('Failed to delete class watch', 500);
  }
}
