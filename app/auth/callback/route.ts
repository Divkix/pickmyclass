import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { safeInternalPath } from '@/lib/auth/safe-redirect';
import type { Database } from '@/lib/supabase/database.types';

function redirectBase(request: Request, origin: string): string {
  const forwardedHost = request.headers.get('x-forwarded-host');
  if (process.env.NODE_ENV !== 'development' && forwardedHost) {
    return `https://${forwardedHost}`;
  }
  return origin;
}

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
    const supabase = createServerClient<Database>(
      'https://osopxwuebsefhoxgeojh.supabase.co',
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9zb3B4d3VlYnNlZmhveGdlb2poIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjExMDQ4NzEsImV4cCI6MjA3NjY4MDg3MX0.23x_oMXkh6ELZ78aR1SqroM_X3Hbud8KlTS3RX32tpU',
      {
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
      }
    );

    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      const base = redirectBase(request, origin);

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
