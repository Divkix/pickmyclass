/**
 * Same-origin check for server functions and every state-changing server route, which Clerk's
 * cookie authenticates. Exempt: the Svix-signed webhook and RFC 8058 one-click unsubscribe, which
 * mail clients post cross-site with a token. Kept free of server imports: `app/start.ts` runs the
 * CSRF filter in the client build too.
 */
export function needsCsrfCheck(handlerType: string, method: string, pathname: string): boolean {
  if (handlerType === "serverFn") return true;

  if (method === "GET" || method === "HEAD") return false;

  return pathname !== "/api/webhooks/clerk" && pathname !== "/api/unsubscribe";
}
