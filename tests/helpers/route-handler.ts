import type { AnyRoute } from "@tanstack/react-router";
import type { RouteMethod } from "@tanstack/react-start";

export async function callRouteHandler(
  route: AnyRoute,
  method: RouteMethod,
  request: Request,
  params: Record<string, string> = {},
): Promise<Response> {
  // SAFETY: these tests invoke response-only handlers that read only request and params.
  const handler = route.options.server?.handlers?.[method] as (args: {
    request: Request;
    params: Record<string, string>;
  }) => Response | Promise<Response>;

  return handler({ request, params });
}
