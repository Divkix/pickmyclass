/** Worker adapter tests for the edge HTML cache module. */

import { beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import type { Env } from '@/lib/types/env';

const { cacheGet, cacheIsEligible, cachePut } = vi.hoisted(() => ({
  cacheGet: vi.fn(),
  cacheIsEligible: vi.fn(),
  cachePut: vi.fn(),
}));

vi.mock('cloudflare:workers', () => ({
  DurableObject: class DurableObject {
    constructor(
      // eslint-disable-next-line anti-slop/no-unknown-parameters -- SAFETY: test mock mirrors DurableObject constructor which accepts unknown at I/O boundary
      protected ctx: unknown,
      // eslint-disable-next-line anti-slop/no-unknown-parameters -- SAFETY: test mock mirrors DurableObject constructor which accepts unknown at I/O boundary
      protected env: unknown
    ) {}
  },
  env: {},
}));

vi.mock('@/lib/queue/dlq-consumer', () => ({ handleDLQMessage: vi.fn() }));
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
// eslint-disable-next-line anti-slop/no-chained-type-assertions -- SAFETY: test double needs unknown intermediate because minimal mock not overlapping ExecutionContext
const ctx = {
  waitUntil,
  passThroughOnException: vi.fn(),
} as unknown as ExecutionContext;
// eslint-disable-next-line anti-slop/no-chained-type-assertions -- SAFETY: test double needs unknown intermediate because minimal mock not overlapping Env
const env = {
  CF_VERSION_METADATA: { id: 'version-1', tag: 'tag', timestamp: 'timestamp' },
} as unknown as Env;

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
    expect(render).toHaveBeenCalledWith(request);
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
});
