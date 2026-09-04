import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import { createEdgeHtmlCache, edgeHtmlCache } from '@/lib/worker/edge-html-cache';

const match = vi.fn<(key: Request) => Promise<Response | undefined>>();
const put = vi.fn<(key: Request, response: Response) => Promise<void>>();

function get(path: string, headers?: HeadersInit): Request {
  return new Request(`https://pickmyclass.app${path}`, { headers });
}

function html(body: string, init?: ResponseInit): Response {
  const response = new Response(body, init);
  response.headers.set('content-type', 'text/html; charset=utf-8');
  return response;
}

describe('edgeHtmlCache', () => {
  const cache = createEdgeHtmlCache(() => ({ match, put }));

  beforeEach(() => {
    vi.clearAllMocks();
    match.mockResolvedValue(undefined);
    put.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each(['/', '/faq', '/about', '/blog', '/blog/post', '/legal', '/legal/privacy'])(
    'allows anonymous document GETs to %s',
    (path) => {
      expect(cache.isEligible(get(path))).toBe(true);
    }
  );

  it.each([
    ['non-allowlisted path', get('/dashboard')],
    ['non-GET method', new Request('https://pickmyclass.app/', { method: 'POST' })],
    ['Clerk auth cookie', get('/', { cookie: '__session=abc' })],
    ['RSC header', get('/', { rsc: '1' })],
    ['RSC query parameter', get('/?_rsc=abc123')],
  ])('rejects %s', (_case, request) => {
    expect(cache.isEligible(request)).toBe(false);
  });

  it('looks up by pathname and deploy version while ignoring the query string', async () => {
    const cached = new Response('cached');
    match.mockResolvedValueOnce(cached);

    await expect(cache.get(get('/blog/post?utm_source=x'), 'version-1')).resolves.toBe(cached);
    expect(match).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'https://edge-cache.internal/version-1/blog/post',
      })
    );
  });

  it('uses a dev cache namespace when deploy metadata is unavailable', async () => {
    await cache.get(get('/'), undefined);

    expect((match.mock.calls[0]![0] as Request).url).toBe('https://edge-cache.internal/dev/');
  });

  it('resolves the Cloudflare default cache lazily in the production singleton', async () => {
    vi.stubGlobal('caches', { default: { match, put } });

    await edgeHtmlCache.get(get('/'), 'version-1');

    expect(match).toHaveBeenCalledOnce();
  });

  it('stores successful HTML with the TTL while preserving CSP nonce headers and body', async () => {
    const response = html('<script nonce="abc">boot()</script>', {
      status: 200,
      headers: { 'content-security-policy': "script-src 'nonce-abc'" },
    });

    const write = cache.put(get('/?utm=x'), 'version-1', response);

    expect(write).not.toBeNull();
    await write;
    expect((put.mock.calls[0]![0] as Request).url).toBe('https://edge-cache.internal/version-1/');
    const stored = put.mock.calls[0]![1] as Response;
    expect(stored.headers.get('cache-control')).toBe('public, s-maxage=3600');
    expect(stored.headers.get('content-security-policy')).toBe("script-src 'nonce-abc'");
    expect(await stored.text()).toContain('nonce="abc"');
  });

  it.each([
    ['non-200 response', html('not found', { status: 404 })],
    ['non-HTML response', new Response('0:["flight"]', { status: 200 })],
    [
      'response with Set-Cookie',
      html('personalized', { status: 200, headers: { 'set-cookie': 'session=abc' } }),
    ],
  ])('does not store a %s', async (_case, response) => {
    expect(cache.put(get('/'), 'version-1', response)).toBeNull();
    expect(put).not.toHaveBeenCalled();
  });
});
