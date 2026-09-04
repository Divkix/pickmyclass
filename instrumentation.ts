import { captureServerException } from '@/lib/analytics/server';

interface RequestErrorContext {
  routerKind: 'Pages Router' | 'App Router';
  routePath: string;
  routeType: 'render' | 'route' | 'action' | 'middleware';
  revalidateReason?: 'on-demand' | 'stale';
}

interface RequestErrorRequest {
  path: string;
  method: string;
}

export function onRequestError(
  error: Error,
  request: RequestErrorRequest,
  context: RequestErrorContext
): Promise<void> {
  return captureServerException(error, {
    path: request.path,
    method: request.method,
    route_path: context.routePath,
    route_type: context.routeType,
    router_kind: context.routerKind,
  });
}
