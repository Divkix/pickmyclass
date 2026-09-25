import { beforeEach, describe, expect, it, vi } from 'vite-plus/test';

const {
  mockCaptureImmediate,
  mockCaptureExceptionImmediate,
  mockPostHog,
  mockShutdown,
  mockWaitUntil,
  mockWarn,
} = vi.hoisted(() => ({
  mockCaptureImmediate: vi.fn(),
  mockCaptureExceptionImmediate: vi.fn(),
  mockPostHog: vi.fn(),
  mockShutdown: vi.fn(),
  mockWaitUntil: vi.fn<(promise: Promise<void>) => void>(),
  mockWarn: vi.fn(),
}));

vi.mock('posthog-node', () => ({
  PostHog: class {
    constructor(...args: unknown[]) {
      mockPostHog(...args);

      return {
        captureImmediate: mockCaptureImmediate,
        captureExceptionImmediate: mockCaptureExceptionImmediate,
        shutdown: mockShutdown,
      };
    }
  },
}));

vi.mock('cloudflare:workers', () => ({
  waitUntil: mockWaitUntil,
}));

vi.mock('@/lib/log', () => ({
  log: vi.fn(() => ({ warn: mockWarn })),
}));

import { POSTHOG_PROJECT_TOKEN } from '@/lib/analytics/config';
import {
  captureServerEvent,
  captureServerException,
  distinctIdFromCookieHeader,
} from '@/lib/analytics/server';

async function registeredPromise(index = 0, expectedCalls = 1): Promise<void> {
  expect(mockWaitUntil).toHaveBeenCalledTimes(expectedCalls);
  expect(mockWaitUntil).toHaveBeenCalledWith(expect.any(Promise));

  return mockWaitUntil.mock.calls[index][0];
}

describe('server-side analytics boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCaptureImmediate.mockResolvedValue(undefined);
    mockCaptureExceptionImmediate.mockResolvedValue(undefined);
    mockShutdown.mockResolvedValue(undefined);
  });

  it('creates a fresh client per send with bounded, retry-free options and the managed host', async () => {
    captureServerEvent('user-1', 'user_unsubscribed', {});
    captureServerEvent('user-2', 'account_deleted', {});

    expect(mockPostHog).toHaveBeenCalledTimes(2);
    expect(mockPostHog).toHaveBeenNthCalledWith(
      1,
      'phc_rRbMvons2ERXqNoArYFrmJYAwTX5YnWmLsnqPgk58Wwo',
      expect.objectContaining({
        host: 'https://s.pickmyclass.app',
        flushAt: 1,
        flushInterval: 0,
        fetchRetryCount: 0,
        requestTimeout: 1_000,
      })
    );
    await Promise.all([registeredPromise(0, 2), registeredPromise(1, 2)]);
  });

  it('forwards the typed event through captureImmediate and shuts down exactly once', async () => {
    captureServerEvent('user-1', 'class_watch_created', { term: '2267', class_nbr: '12345' });

    expect(mockCaptureImmediate).toHaveBeenCalledWith({
      distinctId: 'user-1',
      event: 'class_watch_created',
      properties: { term: '2267', class_nbr: '12345' },
    });

    await registeredPromise();

    expect(mockShutdown).toHaveBeenCalledTimes(1);
    expect(mockShutdown).toHaveBeenCalledWith(1_000);
    expect(mockWarn).not.toHaveBeenCalled();
  });

  it('fails open when the event send fails: logs, still shuts down, never rejects', async () => {
    mockCaptureImmediate.mockRejectedValueOnce(new Error('analytics unavailable'));

    captureServerEvent('user-1', 'data_exported', {});

    await expect(registeredPromise()).resolves.toBeUndefined();
    expect(mockWarn).toHaveBeenCalledWith('Failed to send analytics event:', expect.any(Error));
    expect(mockShutdown).toHaveBeenCalledWith(1_000);
  });

  it('sends exceptions without a distinct id so metadata lands in the properties slot', async () => {
    const failure = new Error('render exploded');
    const pending = captureServerException(failure, { route_path: '/dashboard/[id]' });

    expect(mockCaptureExceptionImmediate).toHaveBeenCalledWith(
      failure,
      undefined,
      expect.objectContaining({ route_path: '/dashboard/[id]' })
    );

    await expect(pending).resolves.toBeUndefined();
    expect(mockShutdown).toHaveBeenCalledTimes(1);
    expect(mockShutdown).toHaveBeenCalledWith(1_000);
  });

  it('returns the exception promise even when sending fails, and still shuts down', async () => {
    mockCaptureExceptionImmediate.mockRejectedValueOnce(new Error('analytics unavailable'));

    await expect(captureServerException(new Error('boom'))).resolves.toBeUndefined();
    expect(mockWarn).toHaveBeenCalledWith('Failed to send analytics exception:', expect.any(Error));
    expect(mockShutdown).toHaveBeenCalledTimes(1);
    expect(mockShutdown).toHaveBeenCalledWith(1_000);
  });
});

describe('analytics client shutdown failures', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCaptureImmediate.mockResolvedValue(undefined);
    mockCaptureExceptionImmediate.mockResolvedValue(undefined);
  });

  it('never rejects the waitUntil promise when shutdown fails after an event', async () => {
    mockShutdown.mockRejectedValueOnce(new Error('shutdown timed out'));

    captureServerEvent('user-1', 'account_deleted', {});

    await expect(registeredPromise()).resolves.toBeUndefined();
    expect(mockWarn).toHaveBeenCalledWith(
      'Failed to shut down analytics client:',
      expect.any(Error)
    );
  });

  it('never rejects the exception capture when shutdown fails', async () => {
    mockShutdown.mockRejectedValueOnce(new Error('shutdown timed out'));

    await expect(captureServerException(new Error('boom'))).resolves.toBeUndefined();
    expect(mockWarn).toHaveBeenCalledWith(
      'Failed to shut down analytics client:',
      expect.any(Error)
    );
  });
});

describe('server exception attribution', () => {
  type PostHogCookieValue = { distinct_id?: string; $sesid?: number[] };

  const phCookie = (value: PostHogCookieValue, token = POSTHOG_PROJECT_TOKEN) =>
    `ph_${token}_posthog=${encodeURIComponent(JSON.stringify(value))}`;

  beforeEach(() => {
    vi.clearAllMocks();
    mockCaptureExceptionImmediate.mockResolvedValue(undefined);
    mockShutdown.mockResolvedValue(undefined);
  });

  it("forwards the distinct id in posthog-node's distinct-id slot", async () => {
    await captureServerException(new Error('boom'), { path: '/x' }, 'anon-123');

    expect(mockCaptureExceptionImmediate).toHaveBeenCalledWith(expect.any(Error), 'anon-123', {
      path: '/x',
    });
  });

  it("reads distinct_id from this project's posthog-js cookie", () => {
    expect(
      distinctIdFromCookieHeader(`__session=abc; ${phCookie({ distinct_id: 'anon-123' })}; x=1`)
    ).toBe('anon-123');
  });

  it('accepts the array form of the cookie header', () => {
    expect(distinctIdFromCookieHeader(['a=1', phCookie({ distinct_id: 'user_9' })])).toBe('user_9');
  });

  it("ignores another project's PostHog cookie", () => {
    expect(distinctIdFromCookieHeader(phCookie({ distinct_id: 'x' }, 'phc_other'))).toBeUndefined();
  });

  it('returns undefined for missing, malformed, or id-less cookies', () => {
    expect(distinctIdFromCookieHeader(undefined)).toBeUndefined();
    expect(
      distinctIdFromCookieHeader(`ph_${POSTHOG_PROJECT_TOKEN}_posthog=%7Bnot-json`)
    ).toBeUndefined();
    expect(distinctIdFromCookieHeader(phCookie({ $sesid: [1] }))).toBeUndefined();
  });
});
