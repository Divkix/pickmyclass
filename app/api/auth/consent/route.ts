import { callFunction } from '@/lib/db/client';
import { type NextRequest } from 'next/server';
import { consentSchema } from '@/lib/api/schemas';
import { fail, ok } from '@/lib/api/response';
import { parseOrFail } from '@/lib/api/validation';
import { invalidateAuthorizationState } from '@/lib/auth/authorization-state';
import { requireUser, UnauthorizedError } from '@/lib/auth/require-user';
import { repairUserMirror } from '@/lib/db/users';
import { log } from '@/lib/log';

export async function POST(request: NextRequest) {
  try {
    const parsed = parseOrFail(consentSchema, await request.json());
    if (!parsed.success) {
      return parsed.response;
    }

    const { user } = await requireUser(request);

    try {
      // Repair the (short) race where a Google-OAuth user reaches consent
      // before their user.created webhook has landed: accept_terms_and_verify_age
      // raises 'User profile not found' without a profile row, so make sure the
      // mirror + profile exist first. No-op once the webhook has synced.
      const result = await repairUserMirror(user.userId, user.clerkUserId);
      if (!result) {
        log('Consent').error(`No primary email on Clerk user ${user.clerkUserId}`);
        return fail('Account setup incomplete — please try again in a moment', 409);
      }

      await callFunction('accept_terms_and_verify_age', [user.userId]);
    } catch (error) {
      log('Consent').error('Failed to persist consent:', error);
      return fail('Could not save consent', 500);
    }

    invalidateAuthorizationState(user.userId);
    return ok(null);
  } catch (error) {
    if (error instanceof UnauthorizedError) return fail('Unauthorized', 401);
    log('Consent').error('Unexpected consent error:', error);
    return fail('Could not save consent', 500);
  }
}
