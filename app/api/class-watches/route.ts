import { env } from 'cloudflare:workers';
import { type NextRequest } from 'next/server';
import { ok, fail } from '@/lib/api/response';
import { withAuth } from '@/lib/api/withAuth';
import { createClassWatchSchema, deleteClassWatchSchema } from '@/lib/api/schemas';
import { parseOrFail } from '@/lib/api/validation';
import { AuthError, type ClassDetails, fetchClassFromASU, NotFoundError } from '@/lib/asu/api';
import { callFunction, execute, query } from '@/lib/db/client';
import type { ClassStateRow, ClassWatchRow } from '@/lib/db/types';
import { upsertClassState } from '@/lib/db/queries';
import { log } from '@/lib/log';
import { captureServerEvent } from '@/lib/posthog-server';
import type { ClassStateRow as ClassStateRowType } from '@/lib/types/class-watch';
import { applyFirstWatchGuard, readOnboardingState, toOnboardingState } from '@/lib/onboarding';

// Get max watches per user from env (default: 10)
const MAX_WATCHES_PER_USER = parseInt(process.env.MAX_WATCHES_PER_USER || '10', 10);

/**
 * GET /api/class-watches
 * Fetch all class watches for the authenticated user with joined class_states data
 */
export async function GET(request: NextRequest) {
  try {
    return await withAuth(request, async (user) => {
      try {
        const watches = await query<ClassWatchRow>(
          `SELECT id, class_nbr, term, subject, catalog_nbr, created_at
           FROM class_watches WHERE user_id = $1 ORDER BY created_at DESC`,
          [user.userId]
        );

        const classNumbers = watches.map((w) => w.class_nbr);
        const terms = Array.from(new Set(watches.map((w) => w.term)));

        // Fetch class states for the user's watches — scoped by both class_nbr AND term
        // so a section number watched in two terms keeps separate states.
        const classStates: ClassStateRowType[] =
          classNumbers.length > 0
            ? await query<ClassStateRow>(
                `SELECT class_nbr, term, seats_available, seats_capacity, non_reserved_seats,
                        instructor_name, title
                 FROM class_states WHERE class_nbr = ANY($1::text[]) AND term = ANY($2::text[])`,
                [classNumbers, terms]
              )
            : [];

        // Expose onboarding state so the dashboard can render the first-time modal
        // / finish-setup card without an extra round trip. The auxiliary read is
        // isolated: a failure logs and projects the module fallback ("not needed")
        // rather than failing the whole watches fetch.
        const onboarding = await readOnboardingState(user.userId).catch((error) => {
          log('API').error('Failed to read onboarding state:', error);
          return toOnboardingState(null);
        });

        const statesMap = classStates.reduce(
          (acc, state) => {
            acc[`${state.term}:${state.class_nbr}`] = state;
            return acc;
          },
          // SAFETY: empty object is the initial typed accumulator for the keyed map
          {} as Record<string, ClassStateRowType>
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

        // Step 2: Create class watch atomically (prevents concurrent limit bypass).
        // The RPC enforces the watch limit via an advisory lock.
        let watchDataRaw: ClassWatchRow | null = null;
        try {
          const rows = await callFunction<ClassWatchRow>('create_class_watch_with_limit', [
            user.userId,
            term,
            classDetails.subject.toUpperCase(),
            classDetails.catalog_nbr,
            class_nbr,
            MAX_WATCHES_PER_USER,
          ]);
          watchDataRaw = rows[0] ?? null;
        } catch (insertError) {
          // SAFETY: pg error has code and message properties for identifying constraint violations
          const pgError = insertError as { code?: string; message?: string };
          // Handle unique constraint violation
          if (pgError.code === '23505') {
            return fail('You are already watching this class', 409);
          }

          // Handle atomic limit-enforcement function error.
          if (
            pgError.code === 'P0001' &&
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
          await upsertClassState({ class_nbr, term }, classDetails);
        } catch (dbError) {
          log('API').error('Failed to persist class state:', dbError);
          // Continue anyway - watch was created successfully
        }

        // Step 4: Mark onboarding complete on the user's first class watch so the
        // finish-setup card stops reappearing. The guard only checks
        // `onboarding_completed_at IS NULL`, so a user who skipped onboarding
        // still transitions to completed on their first watch (ADR 0010).
        try {
          await applyFirstWatchGuard(user.userId);
        } catch (dbError) {
          log('API').error('Failed to mark onboarding complete:', dbError);
          // Non-fatal - watch was created successfully
        }

        await captureServerEvent({
          distinctId: user.userId,
          event: 'class_watch_created',
          properties: {
            term,
            class_nbr,
            subject: classDetails.subject.toUpperCase(),
            catalog_nbr: classDetails.catalog_nbr,
          },
        });

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

        // Delete the watch — app-layer authz ensures user can only delete their own
        await execute('DELETE FROM class_watches WHERE id = $1 AND user_id = $2', [
          parsed.data.id,
          user.userId,
        ]);

        await captureServerEvent({
          distinctId: user.userId,
          event: 'class_watch_deleted',
          properties: { watch_id: parsed.data.id },
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
