const SUPABASE_AUTH_COOKIE_PREFIX = 'sb-';
const SUPABASE_AUTH_COOKIE_SUFFIX = '-auth-token';

export function isSupabaseAuthCookieName(cookieName: string): boolean {
  return (
    cookieName.startsWith(SUPABASE_AUTH_COOKIE_PREFIX) &&
    cookieName.endsWith(SUPABASE_AUTH_COOKIE_SUFFIX)
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
