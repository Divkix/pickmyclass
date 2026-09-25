import { beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import type { Env } from '@/lib/types/env';

const { cacheGet, cacheIsEligible, cachePut } = vi.hoisted(() => ({
  cacheGet: vi.fn(),
  cacheIsEligible: vi.fn(),
  cachePut: vi.fn(),
}));

vi.mock('@/lib/queue/process-section', () => ({ processSection: vi.fn() }));

vi.mock('@/lib/worker/edge-html-cache', () => ({
  edgeHtmlCache: {
    isEligible: cacheIsEligible,
    get: cacheGet,
    put: cachePut,
  },
}));

const worker = (await import('@/worker')).default;

const handler = (await import('vinext/server/app-router-entry')).default;

const waitUntil = vi.fn();

// SAFETY: worker.fetch only calls ctx.waitUntil, delegated to the spy asserted below (worker.ts).
const ctx = {
  waitUntil: (promise: Promise<unknown>) => waitUntil(promise),
  passThroughOnException: () => {},
} as ExecutionContext;

// SAFETY: the tested fetch paths read only env.CF_VERSION_METADATA.id, which the literal provides.
const env = {
  CF_VERSION_METADATA: { id: 'version-1', tag: 'tag', timestamp: 'timestamp' },
} as Env;

describe('worker edge HTML cache adapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cacheIsEligible.mockReturnValue(false);
    cacheGet.mockResolvedValue(undefined);
    cachePut.mockReturnValue(null);
  });

  it('renders directly when the cache module rejects the request', async () => {
    const request = new Request('https://pickmyclass.app/dashboard');
    const render = vi.spyOn(handler, 'fetch').mockResolvedValue(new Response('dashboard'));

    await expect(worker.fetch(request, env, ctx)).resolves.toBeInstanceOf(Response);

    expect(cacheIsEligible).toHaveBeenCalledWith(request);
    expect(cacheGet).not.toHaveBeenCalled();
    expect(render).toHaveBeenCalledWith(request, env, ctx);
  });

  it('returns a cache hit without rendering', async () => {
    const request = new Request('https://pickmyclass.app/');
    const cached = new Response('cached');
    cacheIsEligible.mockReturnValue(true);
    cacheGet.mockResolvedValue(cached);
    const render = vi.spyOn(handler, 'fetch');

    await expect(worker.fetch(request, env, ctx)).resolves.toBe(cached);

    expect(cacheGet).toHaveBeenCalledWith(request, 'version-1');
    expect(render).not.toHaveBeenCalled();
    expect(cachePut).not.toHaveBeenCalled();
  });

  it('renders a miss and schedules the module cache write', async () => {
    const request = new Request('https://pickmyclass.app/');
    const response = new Response('fresh');
    const write = Promise.resolve();
    cacheIsEligible.mockReturnValue(true);
    cachePut.mockReturnValue(write);
    vi.spyOn(handler, 'fetch').mockResolvedValue(response);

    await expect(worker.fetch(request, env, ctx)).resolves.toBe(response);

    expect(cachePut).toHaveBeenCalledWith(request, 'version-1', response);
    expect(waitUntil).toHaveBeenCalledWith(write);
  });

  it('serves markdown without reading or writing the edge cache', async () => {
    const request = new Request('https://pickmyclass.app/', {
      headers: { accept: 'text/markdown' },
    });

    const rendered = new Response('<main><h1>Open seats</h1></main>');
    rendered.headers.set('content-type', 'text/html; charset=utf-8');
    cacheIsEligible.mockReturnValue(true);
    vi.spyOn(handler, 'fetch').mockResolvedValue(rendered);

    const response = await worker.fetch(request, env, ctx);

    expect(response.headers.get('content-type')).toBe('text/markdown; charset=utf-8');
    await expect(response.text()).resolves.toContain('# Open seats');
    expect(cacheGet).not.toHaveBeenCalled();
    expect(cachePut).not.toHaveBeenCalled();
  });

  it('adds Accept to the HTML Vary before the cache write', async () => {
    const request = new Request('https://pickmyclass.app/');
    const rendered = new Response('<main><h1>Open seats</h1></main>');
    rendered.headers.set('content-type', 'text/html; charset=utf-8');
    cacheIsEligible.mockReturnValue(true);
    cachePut.mockReturnValue(Promise.resolve());
    vi.spyOn(handler, 'fetch').mockResolvedValue(rendered);

    const response = await worker.fetch(request, env, ctx);

    expect(response.headers.get('vary')).toBe('Accept');
    const stored = cachePut.mock.calls[0]?.[2] ?? null;
    // SAFETY: cachePut is an untyped vi.fn stub; the worker passes the response it rendered.
    const storedHeaders = (stored as Response).headers;
    expect(storedHeaders.get('vary')).toContain('Accept');
  });
});
