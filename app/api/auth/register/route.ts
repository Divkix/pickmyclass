import { env } from 'cloudflare:workers';
import { type NextRequest } from 'next/server';
import { registerSchema } from '@/lib/api/schemas';
import { log } from '@/lib/log';
import { parseOrFail } from '@/lib/api/validation';
import { fail, ok } from '@/lib/api/response';
import { isDisposableEmail } from '@/lib/auth/disposable-email';
import { captureServerEvent } from '@/lib/posthog-server';
import { createClient } from '@/lib/supabase/server';

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

    const siteUrl = env.NEXT_PUBLIC_SITE_URL || request.nextUrl.origin || 'https://pickmyclass.app';
    const supabase = await createClient();
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${siteUrl}/auth/callback?next=/dashboard`,
        // Consent is persisted by the handle_new_user trigger from this metadata
        // at profile-creation time (no session exists yet for a client-side RPC).
        data: {
          age_verified: ageVerified,
          agreed_to_terms: agreedToTerms,
        },
      },
    });

    if (error) {
      return fail(error.message, 400);
    }

    // Prevent account-enumeration oracle: duplicate and new registrations
    // return the same generic success response. Supabase signals a duplicate
    // via an empty identities array.
    if (data.user?.identities?.length === 0) {
      log('Register').info('Duplicate registration attempt suppressed');
      return ok(null);
    }

    if (data.user) {
      await captureServerEvent({
        distinctId: data.user.id,
        event: 'user_registered',
        properties: { auth_provider: 'email' },
        identify: { email },
      });
    }

    return ok(null);
  } catch (err) {
    log('Auth').error('Unexpected error:', err);
    return fail('Failed to create account', 500);
  }
}
