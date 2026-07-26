import { type NextRequest } from 'next/server';
import { consentSchema } from '@/lib/api/schemas';
import { fail, ok } from '@/lib/api/response';
import { mapValidationIssues } from '@/lib/api/validation';
import { invalidateAuthorizationState } from '@/lib/auth/authorization-state';
import { requireUser, UnauthorizedError } from '@/lib/auth/require-user';
import { log } from '@/lib/log';
import { createClient } from '@/lib/supabase/server';

export async function POST(request: NextRequest) {
  try {
    const validation = consentSchema.safeParse(await request.json());
    if (!validation.success) {
      return fail('Invalid input', 400, mapValidationIssues(validation.error));
    }

    const supabase = await createClient();
    const { user } = await requireUser(supabase);

    const { error } = await supabase.rpc('accept_terms_and_verify_age');
    if (error) {
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
