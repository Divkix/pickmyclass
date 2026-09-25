import { captureServerException, distinctIdFromCookieHeader } from '@/lib/analytics/server';

interface RequestErrorContext {
  routerKind: 'Pages Router' | 'App Router';
  routePath: string;
  routeType: 'render' | 'route' | 'action' | 'middleware';
  revalidateReason?: 'on-demand' | 'stale';
}

interface RequestErrorRequest {
  path: string;
  method: string;
  headers?: Record<string, string | string[] | undefined>;
}

export function onRequestError(
  error: Error,
  request: RequestErrorRequest,
  context: RequestErrorContext
): Promise<void> {
  // Headers never leave the Worker: the PostHog cookie is read only to recover
  // the browser's distinct id so the exception joins that person.
  return captureServerException(
    error,
    {
      path: request.path,
      method: request.method,
      route_path: context.routePath,
      route_type: context.routeType,
      router_kind: context.routerKind,
    },
    distinctIdFromCookieHeader(request.headers?.cookie)
  );
}
