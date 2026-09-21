import { describe, expect, it } from 'vite-plus/test';
import { withJsonApiError } from '@/lib/worker/api-errors';

function htmlResponse(status: number): Response {
  const response = new Response('<html><body><h1>404</h1></body></html>', { status });
  response.headers.set('content-type', 'text/html; charset=utf-8');

  return response;
}

describe('withJsonApiError', () => {
  it('recasts an unmatched API path as a JSON error that keeps the status', async () => {
    const response = withJsonApiError(htmlResponse(404), '/api/nope', 'GET');

    expect(response.status).toBe(404);
    expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: 'No API route matches GET /api/nope',
      details: {
        code: 'not_found',
        status: 404,
        resolution: 'Public endpoints are documented at https://pickmyclass.app/openapi.json',
      },
    });
  });

  it('names the method that was not allowed', async () => {
    const response = withJsonApiError(
      new Response(null, { status: 405 }),
      '/api/monitoring/health',
      'POST'
    );

    await expect(response.json()).resolves.toMatchObject({
      error: 'POST is not allowed on /api/monitoring/health',
      details: { code: 'method_not_allowed' },
    });
  });

  it('leaves page responses, successes, and JSON errors untouched', () => {
    const page = htmlResponse(404);
    expect(withJsonApiError(page, '/faq', 'GET')).toBe(page);

    const renderedApiPage = htmlResponse(400);
    expect(withJsonApiError(renderedApiPage, '/api/unsubscribe', 'GET')).toBe(renderedApiPage);

    const jsonError = Response.json({ success: false, error: 'Unauthorized' }, { status: 404 });
    expect(withJsonApiError(jsonError, '/api/nope', 'GET')).toBe(jsonError);

    const ok = new Response('{"status":"ok"}', { status: 200 });
    expect(withJsonApiError(ok, '/api/monitoring/health', 'GET')).toBe(ok);
  });
});
