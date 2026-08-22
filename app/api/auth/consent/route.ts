import { callFunction } from '@/lib/db/client';
import { type NextRequest } from 'next/server';
import { consentSchema } from '@/lib/api/schemas';
import { fail, ok } from '@/lib/api/response';
import { parseOrFail } from '@/lib/api/validation';
import { invalidateAuthorizationState } from '@/lib/auth/authorization-state';
import { requireUser, UnauthorizedError } from '@/lib/auth/require-user';
import { log } from '@/lib/log';
import { createClient } from '@/lib/supabase/server';

export async function POST(request: NextRequest) {
  try {
    const parsed = parseOrFail(consentSchema, await request.json());
    if (!parsed.success) {
      return parsed.response;
    }

    const supabase = await createClient();
    const { user } = await requireUser(supabase);

    try {
      await callFunction('accept_terms_and_verify_age', [user.id]);
    } catch (error) {
      log('Consent').error('Failed to persist consent:', error);
      return fail('Could not save consent', 500);
    }

    invalidateAuthorizationState(user.id);
    return ok(null);
  } catch (error) {
    if (error instanceof UnauthorizedError) return fail('Unauthorized', 401);
    log('Consent').error('Unexpected consent error:', error);
    return fail('Could not save consent', 500);
  }
}
