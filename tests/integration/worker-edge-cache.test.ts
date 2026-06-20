/**
 * Integration tests for worker.ts edge HTML cache (anonymous marketing pages).
 *
 * The fetch handler serves allowlisted, anonymous GET pages from caches.default,
 * skipping the vinext RSC render on a hit. Covers:
 * - cache HIT returns the stored response without calling handler.fetch
 * - cache MISS calls handler.fetch then stores 200 / no-Set-Cookie responses
 * - requests with Supabase auth cookies bypass the cache (fresh render)
 * - non-allowlisted paths and non-GET methods bypass the cache
 * - non-200 and Set-Cookie responses are never stored
 * - the deploy version id is part of the cache key (deploys bust the cache)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import type { Env } from '@/lib/types/env';

// ── Module mocks (must be hoisted above imports) ──────────────────────────────

vi.mock('cloudflare:workers', () => ({
  DurableObject: class DurableObject {
    constructor(
      protected ctx: unknown,
      protected env: unknown
    ) {}
  },
  env: {},
}));

vi.mock('@/lib/queue/dlq-consumer', () => ({
  handleDLQMessage: vi.fn(),
}));

vi.mock('@/lib/queue/process-section', () => ({
  processSection: vi.fn(),
}));

// ── Imports ───────────────────────────────────────────────────────────────────

const workerModule = await import('@/worker');
const workerDefault = workerModule.default;
const handlerMock = await import('vinext/server/app-router-entry');

// ── Helpers ───────────────────────────────────────────────────────────────────

const matchMock = vi.fn<(key: Request) => Promise<Response | undefined>>();
const putMock = vi.fn<(key: Request, res: Response) => Promise<void>>();

const testCtx = {
  waitUntil: vi.fn(),
  passThroughOnException: vi.fn(),
} as unknown as ExecutionContext;

function makeEnv(versionId?: string): Env {
  return {
    CF_VERSION_METADATA: versionId ? { id: versionId, tag: 't', timestamp: 'ts' } : undefined,
  } as unknown as Env;
}

function get(path: string, headers?: Record<string, string>): Request {
  return new Request(`https://pickmyclass.app${path}`, { method: 'GET', headers });
}

beforeEach(() => {
  vi.clearAllMocks();
  matchMock.mockResolvedValue(undefined);
  putMock.mockResolvedValue(undefined);
  (globalThis as { caches?: unknown }).caches = {
    default: { match: matchMock, put: putMock },
  };
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── Tests ───────────────────────────────────────────────────────────────────

describe('worker fetch handler — edge HTML cache', () => {
  it('returns the cached response on a hit without calling handler.fetch', async () => {
    const cached = new Response('cached home', { status: 200 });
    matchMock.mockResolvedValueOnce(cached);
    const fetchSpy = vi.spyOn(handlerMock.default, 'fetch');

    const res = await workerDefault.fetch(get('/'), makeEnv(), testCtx);

    expect(await res.text()).toBe('cached home');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(putMock).not.toHaveBeenCalled();
  });

  it('renders and stores a 200 response on a cache miss', async () => {
    const fetchSpy = vi
      .spyOn(handlerMock.default, 'fetch')
      .mockResolvedValueOnce(new Response('fresh home', { status: 200 }));

    const res = await workerDefault.fetch(get('/'), makeEnv(), testCtx);

    expect(await res.text()).toBe('fresh home');
    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(putMock).toHaveBeenCalledOnce();
    const storedKey = putMock.mock.calls[0]![0] as Request;
    expect(storedKey.url).toBe('https://edge-cache.internal/dev/');
    const storedRes = putMock.mock.calls[0]![1] as Response;
    expect(storedRes.headers.get('Cache-Control')).toBe('public, s-maxage=3600');
  });

  it('caches nested blog and legal pages', async () => {
    vi.spyOn(handlerMock.default, 'fetch').mockResolvedValue(new Response('post', { status: 200 }));

    await workerDefault.fetch(get('/blog/asu-waitlist-guide'), makeEnv(), testCtx);
    await workerDefault.fetch(get('/legal/privacy'), makeEnv(), testCtx);

    expect(putMock).toHaveBeenCalledTimes(2);
    expect((putMock.mock.calls[0]![0] as Request).url).toBe(
      'https://edge-cache.internal/dev/blog/asu-waitlist-guide'
    );
    expect((putMock.mock.calls[1]![0] as Request).url).toBe(
      'https://edge-cache.internal/dev/legal/privacy'
    );
  });

  it('ignores the query string in the cache key', async () => {
    vi.spyOn(handlerMock.default, 'fetch').mockResolvedValueOnce(
      new Response('home', { status: 200 })
    );

    await workerDefault.fetch(get('/?utm_source=x&ref=y'), makeEnv(), testCtx);

    expect((matchMock.mock.calls[0]![0] as Request).url).toBe('https://edge-cache.internal/dev/');
  });

  it('bypasses the cache when a Supabase auth cookie is present', async () => {
    const fetchSpy = vi
      .spyOn(handlerMock.default, 'fetch')
      .mockResolvedValueOnce(new Response('home', { status: 200 }));

    await workerDefault.fetch(
      get('/', { cookie: 'sb-osopxwuebsefhoxgeojh-auth-token=abc' }),
      makeEnv(),
      testCtx
    );

    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(matchMock).not.toHaveBeenCalled();
    expect(putMock).not.toHaveBeenCalled();
  });

  it('bypasses the cache for non-allowlisted paths', async () => {
    const fetchSpy = vi
      .spyOn(handlerMock.default, 'fetch')
      .mockResolvedValueOnce(new Response('dash', { status: 200 }));

    await workerDefault.fetch(get('/dashboard'), makeEnv(), testCtx);

    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(matchMock).not.toHaveBeenCalled();
    expect(putMock).not.toHaveBeenCalled();
  });

  it('bypasses the cache for non-GET methods', async () => {
    const fetchSpy = vi
      .spyOn(handlerMock.default, 'fetch')
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));

    const req = new Request('https://pickmyclass.app/', { method: 'POST' });
    await workerDefault.fetch(req, makeEnv(), testCtx);

    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(matchMock).not.toHaveBeenCalled();
  });

  it('does not store non-200 responses', async () => {
    vi.spyOn(handlerMock.default, 'fetch').mockResolvedValueOnce(
      new Response('not found', { status: 404 })
    );

    await workerDefault.fetch(get('/blog/missing'), makeEnv(), testCtx);

    expect(putMock).not.toHaveBeenCalled();
  });

  it('does not store responses that set cookies', async () => {
    vi.spyOn(handlerMock.default, 'fetch').mockResolvedValueOnce(
      new Response('home', { status: 200, headers: { 'set-cookie': 'a=b' } })
    );

    await workerDefault.fetch(get('/'), makeEnv(), testCtx);

    expect(putMock).not.toHaveBeenCalled();
  });

  it('includes the deploy version id in the cache key so deploys bust the cache', async () => {
    vi.spyOn(handlerMock.default, 'fetch').mockResolvedValue(new Response('home', { status: 200 }));

    await workerDefault.fetch(get('/'), makeEnv('v1abc'), testCtx);
    expect((matchMock.mock.calls[0]![0] as Request).url).toBe('https://edge-cache.internal/v1abc/');

    await workerDefault.fetch(get('/'), makeEnv('v2def'), testCtx);
    expect((matchMock.mock.calls[1]![0] as Request).url).toBe('https://edge-cache.internal/v2def/');
  });
});
