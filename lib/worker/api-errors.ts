/**
 * JSON errors for unmatched API paths.
 *
 * A wrong URL or method under `/api/` fell through to the rendered HTML 404
 * page: readable for a browser, a dead end for an agent or a script. Routing
 * failures now answer with the same envelope the route handlers use
 * (`success`, `error`, `details`), so a client can branch on `details.code`
 * and follow `details.resolution`.
 *
 * Only 404 and 405 are recast. Handlers that answer a human with a rendered
 * page (the unsubscribe confirmation, for example) keep their own response.
 */
const API_PREFIX = '/api/';
const ROUTING_FAILURES = new Set([404, 405]);
const DOCS_URL = 'https://pickmyclass.app/openapi.json';

function errorBody(status: number, method: string, pathname: string) {
  const code = status === 404 ? 'not_found' : 'method_not_allowed';
  const message =
    status === 404
      ? `No API route matches ${method} ${pathname}`
      : `${method} is not allowed on ${pathname}`;

  return {
    success: false,
    error: message,
    details: {
      code,
      status,
      resolution: `Public endpoints are documented at ${DOCS_URL}`,
    },
  };
}

/** Recasts a routing failure under `/api/` as JSON; everything else passes through. */
export function withJsonApiError(response: Response, pathname: string, method: string): Response {
  if (!pathname.startsWith(API_PREFIX) || !ROUTING_FAILURES.has(response.status)) return response;

  const isJson = response.headers.get('content-type')?.toLowerCase().includes('json') ?? false;
  if (isJson) return response;

  return new Response(JSON.stringify(errorBody(response.status, method, pathname)), {
    status: response.status,
    statusText: response.statusText,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}
