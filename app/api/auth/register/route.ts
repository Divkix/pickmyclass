import { ClerkAPIResponseError } from '@clerk/backend/errors';
import { env } from 'cloudflare:workers';
import { type NextRequest } from 'next/server';
import { registerSchema } from '@/lib/api/schemas';
import { log } from '@/lib/log';
import { parseOrFail } from '@/lib/api/validation';
import { fail, ok } from '@/lib/api/response';
import { getClerkClient } from '@/lib/auth/clerk-session';
import { isDisposableEmail } from '@/lib/auth/disposable-email';
import { captureServerEvent } from '@/lib/posthog-server';

/** True when the Clerk Backend API rejected the createUser for a duplicate email. */
// eslint-disable-next-line anti-slop/no-unknown-parameters -- LEGIT: error-boundary predicate must accept unknown from catch
function isDuplicateEmailError(error: unknown): boolean {
  return (
    error instanceof ClerkAPIResponseError &&
    // eslint-disable-next-line anti-slop/require-safety-comment-for-type-assertion -- SAFETY: guarded by instanceof check above
    (error as ClerkAPIResponseError).errors.some(
      (e: { code: string }) => e.code === 'form_identifier_exists'
    )
  );
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = parseOrFail(registerSchema, body);

    if (!parsed.success) {
      return parsed.response;
    }

    const email = parsed.data.email.toLowerCase();
    const password = parsed.data.password;
    const { ageVerified, agreedToTerms } = parsed.data;

    try {
      // SAFETY: KVNamespace binding is an optional Cloudflare KV binding; shape matches wrangler.jsonc env contract. Nullish fallback handles unbound env in local dev.
      const disposableEnv = env as { PICKMYCLASS_DISPOSABLE_DOMAINS?: KVNamespace };
      const kv = disposableEnv.PICKMYCLASS_DISPOSABLE_DOMAINS ?? null;
      const result = await isDisposableEmail(email, kv);
      if (result.disposable) {
        return fail(
          'This email domain is not accepted. Please use a different email address.',
          422
        );
      }
    } catch (error) {
      // Fail open - if KV is unavailable, allow signup
      log('Register').warn('Failed to check disposable domain, failing open:', error);
    }

    // Create the user via the Clerk Backend API. The users mirror row (and the
    // 1:1 user_profiles row, seeded with consent from publicMetadata) is written
    // by the user.created webhook — see /api/webhooks/clerk.
    try {
      const user = await getClerkClient().users.createUser({
        emailAddress: [email],
        password,
        publicMetadata: {
          age_verified: ageVerified,
          agreed_to_terms: agreedToTerms,
        },
      });

      await captureServerEvent({
        distinctId: user.externalId ?? user.id,
        event: 'user_registered',
        properties: { auth_provider: 'email' },
        identify: { email },
      });

      return ok(null);
    } catch (error) {
      // Anti-enumeration: duplicate registrations return the exact same
      // response as real ones. This replaces the old Supabase
      // `identities.length === 0` signal. The response carries no token or
      // user data for either path, so the two are indistinguishable.
      if (isDuplicateEmailError(error)) {
        log('Register').info('Duplicate registration attempt suppressed');
        return ok(null);
      }

      if (error instanceof ClerkAPIResponseError) {
        // eslint-disable-next-line anti-slop/require-safety-comment-for-type-assertion -- SAFETY: guarded by instanceof ClerkAPIResponseError above
        const clerkErr = error as ClerkAPIResponseError;
        const message = clerkErr.errors[0]?.longMessage ?? clerkErr.errors[0]?.message;
        log('Register').warn('Clerk rejected registration:', clerkErr.errors);
        return fail(message || 'Could not create account', 400);
      }
      throw error;
    }
  } catch (err) {
    log('Auth').error('Unexpected error:', err);
    return fail('Failed to create account', 500);
  }
}
