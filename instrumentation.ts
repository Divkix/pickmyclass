import { errorFields, log } from "@/lib/log";

interface RequestErrorContext {
  routerKind: "Pages Router" | "App Router";
  routePath: string;
  routeType: "render" | "route" | "action" | "middleware";
  revalidateReason?: "on-demand" | "stale";
}

interface RequestErrorRequest {
  path: string;
  method: string;
}

/**
 * vinext reports server render/route/action/middleware errors here. In
 * production it does not log render errors itself, so this is the only place
 * they reach HyperDX.
 */
export function onRequestError(
  error: Error & { digest?: string },
  request: RequestErrorRequest,
  context: RequestErrorContext,
): void {
  // Only render errors are normalised to an Error; route, action and
  // middleware paths forward whatever was thrown, which errorFields tolerates.
  log("RequestError").error("Unhandled request error", {
    method: request.method,
    // Middleware paths carry the query string, which can hold unsubscribe tokens.
    path: request.path.split("?")[0],
    route_type: context.routeType,
    route_path: context.routePath,
    digest: error instanceof Error ? error.digest : undefined,
    ...errorFields(error),
  });
}
