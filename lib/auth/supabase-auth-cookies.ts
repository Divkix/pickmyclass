const SUPABASE_AUTH_COOKIE_PREFIX = 'sb-';
const SUPABASE_AUTH_COOKIE_SUFFIX = '-auth-token';

export function isSupabaseAuthCookieName(cookieName: string): boolean {
  // @supabase/ssr chunks large sessions into sb-<ref>-auth-token.0, .1, ... — strip
  // the chunk suffix before the suffix check so chunked sessions aren't treated as
  // anonymous by the edge HTML cache.
  return (
    cookieName.startsWith(SUPABASE_AUTH_COOKIE_PREFIX) &&
    cookieName.replace(/\.\d+$/, '').endsWith(SUPABASE_AUTH_COOKIE_SUFFIX)
  );
}

export function hasSupabaseAuthCookies(cookieNames: Iterable<string>): boolean {
  for (const cookieName of cookieNames) {
    if (isSupabaseAuthCookieName(cookieName)) {
      return true;
    }
  }

  return false;
}

export function hasSupabaseAuthCookiesInHeader(cookieHeader: string | null): boolean {
  if (!cookieHeader) {
    return false;
  }

  return hasSupabaseAuthCookies(
    cookieHeader.split(';').map((part) => part.trim().split('=', 1)[0] ?? '')
  );
}
