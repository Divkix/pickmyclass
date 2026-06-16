import { env } from 'cloudflare:workers';
import { type NextRequest } from 'next/server';
import { registerSchema } from '@/lib/api/schemas';
import { log } from '@/lib/log';
import { mapValidationIssues } from '@/lib/api/validation';
import { fail, ok } from '@/lib/api/response';
import { isDisposableEmail } from '@/lib/auth/disposable-email';
import { createClient } from '@/lib/supabase/server';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const validation = registerSchema.safeParse(body);

    if (!validation.success) {
      return fail('Invalid input', 400, mapValidationIssues(validation.error));
    }

    const email = validation.data.email.toLowerCase();
    const password = validation.data.password;

    try {
      const kv =
        (env as unknown as { PICKMYCLASS_DISPOSABLE_DOMAINS?: KVNamespace })
          .PICKMYCLASS_DISPOSABLE_DOMAINS ?? null;
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
      },
    });

    if (error) {
      return fail(error.message, 400);
    }

    // Check for duplicate email (Supabase returns user with empty identities)
    if (data.user?.identities?.length === 0) {
      return fail('This email is already registered. Please sign in.', 409, { duplicate: true });
    }

    return ok(null);
  } catch (err) {
    log('Auth').error('Unexpected error:', err);
    return fail('Failed to create account', 500);
  }
}
