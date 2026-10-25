import { isNotFound, isRedirect } from "@tanstack/react-router";
import { createCsrfMiddleware, createMiddleware, createStart } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import {
  gateRequest,
  isGateExempt,
  withDefaultCacheControl,
  withSecurityHeaders,
} from "@/lib/auth/request-gate";
import { logRequestError } from "@/lib/log";

const csrf = createCsrfMiddleware({ filter: (ctx) => ctx.handlerType === "serverFn" });

/**
 * The edge gate on every page and server-route request, and the last stop for
 * what they throw. Server functions are RPC calls without the page's path, so
 * each protected page's server function applies the gate itself
 * (`requirePageAccess`). `nonce` reaches the router's inline scripts.
 */
const gate = createMiddleware().server(async ({ request, pathname, handlerType, next }) => {
  try {
    if (handlerType === "serverFn" || isGateExempt(pathname)) {
      const result = await next({ context: { nonce: undefined } });

      return { ...result, response: withDefaultCacheControl(result.response) };
    }

    const outcome = await gateRequest(request);

    if (outcome.kind === "respond") return outcome.response;

    const result = await next({ context: { nonce: outcome.nonce } });

    return withSecurityHeaders(result.response, outcome.csp);
  } catch (error) {
    logRequestError(error, request);
    throw error;
  }
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
  requestMiddleware: [csrf, gate],
  functionMiddleware: [logServerFnErrors],
}));
