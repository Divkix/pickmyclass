/**
 * Root request instrumentation (vinext/Next.js convention).
 *
 * Forwards unhandled request errors to PostHog Error Tracking. Only the
 * non-identifying routing facts travel with the event — never request
 * headers or query strings. vinext already registers the returned promise
 * with the request execution context (`waitUntil`), so this handler simply
 * returns the analytics promise instead of registering it twice.
 */

import { captureServerException } from '@/lib/analytics/server';

/** Routing context supplied by the framework for the failing unit of work. */
interface RequestErrorContext {
  routerKind: 'Pages Router' | 'App Router';
  routePath: string;
  routeType: 'render' | 'route' | 'action' | 'middleware';
  revalidateReason?: 'on-demand' | 'stale';
}

/** Minimal request description; headers are deliberately omitted downstream. */
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
