import type { AuthObject } from "@clerk/backend";
import { clerkMiddleware } from "@clerk/tanstack-react-start/server";
import { isNotFound, isRedirect } from "@tanstack/react-router";
import {
  createCsrfMiddleware,
  createIsomorphicFn,
  createMiddleware,
  createStart,
} from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { clerkMiddlewareOptions, toSessionIdentity } from "@/lib/auth/clerk-session";
import {
  gateRequest,
  isGateExempt,
  withDefaultCacheControl,
  withSecurityHeaders,
} from "@/lib/auth/request-gate";
import { logRequestError } from "@/lib/log";

const csrf = createCsrfMiddleware({ filter: (ctx) => ctx.handlerType === "serverFn" });

/**
 * Clerk verifies the session once per request. Start keeps `requestMiddleware` in the client
 * build, so Clerk's server entry is created server-side only.
 */
const clerk = createIsomorphicFn()
  .server(() => clerkMiddleware(clerkMiddlewareOptions))
  .client(() => createMiddleware());

/** The last stop for what a page or server-route request throws, Clerk's verification included. */
const logRequestErrors = createMiddleware().server(async ({ request, next }) => {
  try {
    return await next();
  } catch (error) {
    // clerkMiddleware throws its handshake redirect as a Response.
    if (!(error instanceof Response)) logRequestError(error, request);
    throw error;
  }
});

/**
 * The edge gate on every page and server-route request. Server functions are
 * RPC calls without the page's path, so each protected page's server function
 * applies the gate itself (`requirePageAccess`). `nonce` reaches the router's
 * inline scripts.
 */
const gate = createMiddleware()
  .middleware([clerk()])
  .server(async ({ request, pathname, handlerType, context, next }) => {
    if (handlerType === "serverFn" || isGateExempt(pathname)) {
      const result = await next({ context: { nonce: undefined } });

      return { ...result, response: withDefaultCacheControl(result.response) };
    }

    // Clerk's `auth()` needs Start's request context, which begins only after global request
    // middleware, so the gate reads the auth state clerkMiddleware hands to `next()`. Clerk types
    // that context as `any`.
    const clerkAuth: AuthObject = context.auth();
    const outcome = await gateRequest(request, toSessionIdentity(clerkAuth));

    if (outcome.kind === "respond") return outcome.response;

    const result = await next({ context: { nonce: outcome.nonce } });

    return withSecurityHeaders(result.response, outcome.csp);
  });

/** Server functions answer errors as serialized results, so the gate never sees them throw. */
const logServerFnErrors = createMiddleware({ type: "function" }).server(
  async ({ next, serverFnMeta }) => {
    try {
      return await next();
    } catch (error) {
      // Redirects and not-found are router control flow, not failures.
      if (!isRedirect(error) && !isNotFound(error)) {
        logRequestError(error, getRequest(), serverFnMeta.name);
      }

      throw error;
    }
  },
);

export const startInstance = createStart(() => ({
  requestMiddleware: [csrf, logRequestErrors, gate],
  functionMiddleware: [logServerFnErrors],
}));
