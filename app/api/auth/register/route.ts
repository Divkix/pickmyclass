import { env } from 'cloudflare:workers';
import { type NextRequest, NextResponse } from 'next/server';
import { registerSchema } from '@/lib/api/schemas';
import { mapValidationIssues } from '@/lib/api/validation';
import { isDisposableEmail } from '@/lib/auth/disposable-email';
import { createClient } from '@/lib/supabase/server';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const validation = registerSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json(
        {
          error: 'Invalid input',
          details: mapValidationIssues(validation.error),
        },
        { status: 400 }
      );
    }

    const email = validation.data.email.toLowerCase();
    const password = validation.data.password;

    try {
      const kv =
        (env as unknown as { PICKMYCLASS_DISPOSABLE_DOMAINS?: KVNamespace })
          .PICKMYCLASS_DISPOSABLE_DOMAINS ?? null;
      const result = await isDisposableEmail(email, kv);
      if (result.disposable) {
        return NextResponse.json(
          { error: 'This email domain is not accepted. Please use a different email address.' },
          { status: 422 }
        );
      }
    } catch (error) {
      // Fail open - if KV is unavailable, allow signup
      console.warn('[Register] Failed to check disposable domain, failing open:', error);
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
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    // Check for duplicate email (Supabase returns user with empty identities)
    if (data.user?.identities?.length === 0) {
      return NextResponse.json(
        { error: 'This email is already registered. Please sign in.', duplicate: true },
        { status: 409 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[Auth Register] Unexpected error:', err);
    return NextResponse.json({ error: 'Failed to create account' }, { status: 500 });
  }
}
