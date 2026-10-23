import { log } from "@/lib/log";

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
  // middleware paths forward whatever was thrown.
  const detail = error instanceof Error ? (error.stack ?? error.message) : String(error);
  const digest = error instanceof Error && error.digest ? ` digest=${error.digest}` : "";
  // Middleware paths carry the query string, which can hold unsubscribe tokens.
  const path = request.path.split("?")[0];

  log("RequestError").error(
    `${request.method} ${path} (${context.routeType} ${context.routePath})${digest}:`,
    detail,
  );
}
