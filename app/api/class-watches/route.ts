import { env } from 'cloudflare:workers';
import { type NextRequest } from 'next/server';
import { ok, fail } from '@/lib/api/response';
import { createClassWatchSchema, deleteClassWatchSchema } from '@/lib/api/schemas';
import { mapValidationIssues } from '@/lib/api/validation';
import { AuthError, type ClassDetails, fetchClassFromASU, NotFoundError } from '@/lib/asu/api';
import { requireUser, UnauthorizedError } from '@/lib/auth/require-user';
import { upsertClassState } from '@/lib/db/queries';
import { log } from '@/lib/log';
import { getPostHogClient } from '@/lib/posthog-server';
import { createClient } from '@/lib/supabase/server';
import { getServiceClient } from '@/lib/supabase/service';
import type { ClassStateRow } from '@/lib/types/class-watch';
import { applyFirstWatchGuard, toOnboardingState, type OnboardingRow } from '@/lib/onboarding';

// Get max watches per user from env (default: 10)
const MAX_WATCHES_PER_USER = parseInt(process.env.MAX_WATCHES_PER_USER || '10', 10);

/**
 * GET /api/class-watches
 * Fetch all class watches for the authenticated user with joined class_states data
 */
export async function GET() {
  const supabase = await createClient();

  let user: Awaited<ReturnType<typeof requireUser>>['user'];
  try {
    ({ user } = await requireUser(supabase));
  } catch (e) {
    if (e instanceof UnauthorizedError) return fail('Unauthorized', 401);
    throw e;
  }

  try {
    const { data: watches, error: watchesError } = await supabase
      .from('class_watches')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    if (watchesError) throw watchesError;

    const classNumbers = watches?.map((w) => w.class_nbr) || [];
    const terms = Array.from(new Set(watches?.map((w) => w.term) || []));

    let classStates: ClassStateRow[] = [];
    if (classNumbers.length > 0) {
      const { data: states, error: statesError } = await supabase
        .from('class_states')
        .select('*')
        .in('class_nbr', classNumbers)
        .in('term', terms);

      if (statesError) throw statesError;
      classStates = states || [];
    }

    const statesMap = classStates.reduce(
      (acc, state) => {
        acc[`${state.term}:${state.class_nbr}`] = state;
        return acc;
      },
      {} as Record<string, ClassStateRow>
    );

    const watchesWithStates = watches?.map((watch) => ({
      ...watch,
      class_state: statesMap[`${watch.term}:${watch.class_nbr}`] || null,
    }));

    // Expose onboarding state so the dashboard can render the first-time modal
    // / finish-setup card without an extra round trip. Fails open: a profile-read
    // error defaults to "not needed" rather than failing the whole watches fetch.
    const { data: profile, error: profileError } = await supabase
      .from('user_profiles')
      .select('onboarding_completed_at, onboarding_skipped_at')
      .eq('user_id', user.id)
      .maybeSingle();

    if (profileError) {
      log('API').warn('Onboarding state read failed; failing open:', profileError);
    }

    return ok({
      watches: watchesWithStates,
      maxWatches: MAX_WATCHES_PER_USER,
      onboarding: toOnboardingState(profile as OnboardingRow | null),
    });
  } catch (error) {
    log('API').error('Error fetching class watches:', error);
    return fail('Failed to fetch class watches', 500);
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

  let user: Awaited<ReturnType<typeof requireUser>>['user'];
  try {
    ({ user } = await requireUser(supabase));
  } catch (e) {
    if (e instanceof UnauthorizedError) return fail('Unauthorized', 401);
    throw e;
  }

  try {
    const { count: watchCount, error: countError } = await supabase
      .from('class_watches')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id);

    if (countError) {
      log('API').error('Error counting user watches:', countError);
      throw countError;
    }

    if (watchCount !== null && watchCount >= MAX_WATCHES_PER_USER) {
      return fail(
        `Maximum watches limit reached (${MAX_WATCHES_PER_USER}). Delete some watches to add more.`,
        429
      );
    }

    const body = await request.json();
    const validation = createClassWatchSchema.safeParse(body);

    if (!validation.success) {
      return fail('Invalid input', 400, mapValidationIssues(validation.error));
    }

    const { term, class_nbr } = validation.data;

    // Get ASU API env vars (Cloudflare secrets)
    const asuEnv = env as unknown as { ASU_API_BASE_URL: string; ASU_API_TOKEN: string };

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

    // Use service role for atomic insert RPC so clients cannot bypass limit checks by calling it directly.
    const supabaseServiceRole = getServiceClient();

    // Step 2: Create class watch atomically (prevents concurrent limit bypass).
    const { data: watchDataRaw, error: insertError } = await supabaseServiceRole.rpc(
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
        return fail('You are already watching this class', 409);
      }

      // Handle atomic limit-enforcement function error.
      if (
        insertError.code === 'P0001' &&
        typeof insertError.message === 'string' &&
        insertError.message.includes('MAX_WATCHES_EXCEEDED')
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
      await upsertClassState(supabaseServiceRole, { class_nbr, term }, classDetails);
    } catch (dbError) {
      log('API').error('Failed to persist class state:', dbError);
      // Continue anyway - watch was created successfully
    }

    // Step 4: Mark onboarding complete on the user's first class watch so the
    // finish-setup card stops reappearing. Service role bypasses the escalation
    // trigger. The guard only checks `onboarding_completed_at IS NULL`, so a
    // user who skipped onboarding still transitions to completed on their first
    // watch (ADR 0010). See `applyFirstWatchGuard` in `lib/onboarding.ts`.
    try {
      await applyFirstWatchGuard(
        supabaseServiceRole
          .from('user_profiles')
          .update({ onboarding_completed_at: new Date().toISOString() })
          .eq('user_id', user.id)
      );
    } catch (dbError) {
      log('API').error('Failed to mark onboarding complete:', dbError);
      // Non-fatal - watch was created successfully
    }

    const posthog = getPostHogClient();
    posthog.capture({
      distinctId: user.id,
      event: 'class_watch_created',
      properties: {
        term,
        class_nbr,
        subject: classDetails.subject.toUpperCase(),
        catalog_nbr: classDetails.catalog_nbr,
      },
    });
    await posthog.shutdown();

    return ok({ watch: watchDataRaw }, { status: 201 });
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
  const supabase = await createClient();

  let user: Awaited<ReturnType<typeof requireUser>>['user'];
  try {
    ({ user } = await requireUser(supabase));
  } catch (e) {
    if (e instanceof UnauthorizedError) return fail('Unauthorized', 401);
    throw e;
  }

  try {
    const { searchParams } = new URL(request.url);
    const watchId = searchParams.get('id');

    // Validate watch ID
    const validation = deleteClassWatchSchema.safeParse({ id: watchId });

    if (!validation.success) {
      return fail('Invalid input', 400, mapValidationIssues(validation.error));
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

    const posthog = getPostHogClient();
    posthog.capture({
      distinctId: user.id,
      event: 'class_watch_deleted',
      properties: { watch_id: validation.data.id },
    });
    await posthog.shutdown();

    return ok(undefined);
  } catch (error) {
    log('API').error('Error deleting class watch:', error);
    return fail('Failed to delete class watch', 500);
  }
}
