/**
 * Clerk session-cookie detection for the edge gate fast path.
 *
 * Replaces the old `hasSupabaseAuthCookies` check. Clerk (production mode)
 * marks an active browser session with the `__session` JWT cookie plus the
 * `__client_uat` timestamp cookie; development mode additionally uses
 * `__clerk_db_jwt` (dev-browser token). Satellite/suffixed deployments append
 * a key-derived suffix (`__session_<hash>`), so matching is prefix-based.
 *
 * Detection is a CPU-saving heuristic only: the authoritative check is always
 * `clerkMiddleware` (app/start.ts).
 */

const CLERK_SESSION_COOKIE_PREFIXES = [
  "__session",
  "__client_uat",
  "__refresh",
  "__clerk_db_jwt",
  "__clerk_handshake",
] as const;

function isClerkSessionCookieName(cookieName: string): boolean {
  return CLERK_SESSION_COOKIE_PREFIXES.some(
    (prefix) => cookieName === prefix || cookieName.startsWith(`${prefix}_`),
  );
}

function hasClerkSessionCookies(cookieNames: Iterable<string>): boolean {
  for (const cookieName of cookieNames) {
    if (isClerkSessionCookieName(cookieName)) {
      return true;
    }
  }

  return false;
}

export function hasClerkSessionCookiesInHeader(cookieHeader: string | null): boolean {
  if (!cookieHeader) {
    return false;
  }

  return hasClerkSessionCookies(
    cookieHeader.split(";").map((part) => part.trim().split("=", 1)[0] ?? ""),
  );
}

const CLERK_COOKIES_TO_CLEAR = [
  "__session",
  "__client_uat",
  "__refresh",
  "__clerk_db_jwt",
  "__clerk_handshake",
  "__clerk_redirect_count",
] as const;

/**
 * Expires Clerk's cookies. The request's own suffixed cookies (`__session_<hash>`) are cleared by
 * name too: Clerk reads the suffixed cookie before the plain one, so leaving it keeps the session.
 */
export function clearClerkCookies(headers: Headers, cookieHeader: string | null): void {
  const names = new Set<string>(CLERK_COOKIES_TO_CLEAR);

  for (const part of cookieHeader?.split(";") ?? []) {
    const name = part.trim().split("=", 1)[0] ?? "";

    if (isClerkSessionCookieName(name)) names.add(name);
  }

  for (const name of names) {
    headers.append("Set-Cookie", `${name}=; Path=/; Max-Age=0`);
  }
}
