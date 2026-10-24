import type { Instrumentation } from "next";
import { errorFields, isText, log } from "@/lib/log";

/** Next.js stamps a string `digest` on render errors; other throws carry none. */
function digestOf(cause: unknown): string | undefined {
  return cause instanceof Object && "digest" in cause && isText(cause.digest)
    ? cause.digest
    : undefined;
}

/**
 * vinext reports server render/route/action/proxy errors here. In
 * production it does not log render errors itself, so this is the only place
 * they reach HyperDX.
 */
export const onRequestError: Instrumentation.onRequestError = (error, request, context) => {
  // Only render errors are normalised to an Error; route, action and
  // proxy paths forward whatever was thrown, which errorFields tolerates.
  log("RequestError").error("Unhandled request error", {
    method: request.method,
    // Proxy paths carry the query string, which can hold unsubscribe tokens.
    path: request.path.split("?")[0],
    route_type: context.routeType,
    route_path: context.routePath,
    digest: digestOf(error),
    ...errorFields(error),
  });
};
