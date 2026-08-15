import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { safeInternalPath } from '@/lib/auth/safe-redirect';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from '@/lib/supabase/config';
import type { Database } from '@/lib/supabase/database.types';
// Redirects always resolve against the request origin. `x-forwarded-host` is
// client-controllable (host-header injection / open redirect), so it must never
// influence where OAuth callbacks send the user.
function consentRedirect(base: string, next: string, saveFailed = false): NextResponse {
  const url = new URL('/consent', base);
  if (saveFailed) url.searchParams.set('error', 'save_failed');
  url.searchParams.set('next', next);
  return NextResponse.redirect(url);
}

// OAuth callback: cookie setup is required after code exchange
// eslint-disable-next-line react-doctor/nextjs-no-side-effect-in-get-handler
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const consentConfirmed = searchParams.get('consent') === 'confirmed';
  // Default to home - middleware will route to /admin or /dashboard based on is_admin flag
  const next = safeInternalPath(searchParams.get('next'), '/');

  if (code) {
    const cookieStore = await cookies();
    const supabase = createServerClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // The `setAll` method was called from a Server Component.
            // This can be ignored if you have middleware refreshing
            // user sessions.
          }
        },
      },
    });

    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      const base = origin;

      if (consentConfirmed) {
        const { error: consentError } = await supabase.rpc('accept_terms_and_verify_age');
        if (consentError) {
          return consentRedirect(base, next, true);
        }
      } else {
        const { data: profile, error: profileError } = await supabase
          .from('user_profiles')
          .select('age_verified_at, agreed_to_terms_at')
          .maybeSingle();

        if (profileError || !profile?.age_verified_at || !profile.agreed_to_terms_at) {
          return consentRedirect(base, next);
        }
      }

      return NextResponse.redirect(`${base}${next}`);
    }
  }

  // Return the user to an error page with instructions
  return NextResponse.redirect(`${origin}/login?error=oauth_failed`);
}
