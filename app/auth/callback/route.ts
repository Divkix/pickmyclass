import { createServerClient } from '@supabase/ssr'
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'

/**
 * Validates the `next` parameter to prevent open redirect attacks.
 * Only allows safe internal paths.
 */
function validateNextPath(next: string | null): string {
  if (!next) return '/'

  // Decode and check for double-encoding attacks
  let decodedNext: string
  try {
    decodedNext = decodeURIComponent(next)
  } catch {
    return '/'
  }

  // Reject if decoding changed the value (double encoding attack)
  if (decodedNext !== next) return '/'

  // Reject path traversal
  if (next.includes('..')) return '/'

  // Must start with / but not //
  if (!next.startsWith('/') || next.startsWith('//')) return '/'

  // Reject external URLs
  if (next.includes('://')) return '/'

  // Extract path only (ignore query params for validation)
  const pathOnly = next.split('?')[0].split('#')[0]

  // Whitelist of allowed path prefixes
  const allowedPrefixes = ['/', '/dashboard', '/admin', '/settings']
  const isAllowed = allowedPrefixes.some(
    (prefix) => pathOnly === prefix || pathOnly.startsWith(prefix + '/')
  )

  if (!isAllowed) return '/'

  return next
}

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  // Validate next parameter to prevent open redirect
  const next = validateNextPath(searchParams.get('next'))

  if (code) {
    const cookieStore = await cookies()
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll()
          },
          setAll(cookiesToSet) {
            try {
              cookiesToSet.forEach(({ name, value, options }) =>
                cookieStore.set(name, value, options)
              )
            } catch {
              // The `setAll` method was called from a Server Component.
              // This can be ignored if you have middleware refreshing
              // user sessions.
            }
          },
        },
      }
    )

    const { error } = await supabase.auth.exchangeCodeForSession(code)

    if (!error) {
      const forwardedHost = request.headers.get('x-forwarded-host')
      const isLocalEnv = process.env.NODE_ENV === 'development'
      if (isLocalEnv) {
        return NextResponse.redirect(`${origin}${next}`)
      } else if (forwardedHost) {
        return NextResponse.redirect(`https://${forwardedHost}${next}`)
      } else {
        return NextResponse.redirect(`${origin}${next}`)
      }
    }
  }

  // Return the user to an error page with instructions
  return NextResponse.redirect(`${origin}/login?error=oauth_failed`)
}
