import { beforeEach, describe, expect, it, vi } from 'vite-plus/test';

const { mockCaptureServerException } = vi.hoisted(() => ({
  mockCaptureServerException: vi.fn(),
}));

vi.mock('@/lib/analytics/server', () => ({
  captureServerException: mockCaptureServerException,
}));

import { onRequestError } from '../../instrumentation';

describe('root request instrumentation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('forwards only path/method/route context to the analytics boundary', () => {
    const error = new Error('render exploded');
    const sentinel = Promise.resolve();
    const requestWithHeaders = {
      path: '/dashboard/[id]',
      method: 'GET',
      headers: { authorization: 'Bearer secret', cookie: 'session=abc' },
    };

    mockCaptureServerException.mockReturnValue(sentinel);

    const result = onRequestError(error, requestWithHeaders, {
      routerKind: 'App Router',
      routePath: '/dashboard/[id]',
      routeType: 'render',
    });

    expect(result).toBe(sentinel);

    expect(mockCaptureServerException).toHaveBeenCalledTimes(1);
    expect(mockCaptureServerException).toHaveBeenCalledWith(
      error,
      expect.objectContaining({
        path: '/dashboard/[id]',
        method: 'GET',
        route_path: '/dashboard/[id]',
        route_type: 'render',
        router_kind: 'App Router',
      })
    );
  });

  it('never sends request headers or their values as properties', () => {
    const requestWithHeaders = {
      path: '/api/user/delete',
      method: 'DELETE',
      headers: { authorization: 'Bearer secret', cookie: 'session=abc' },
    };
    onRequestError(new Error('route failed'), requestWithHeaders, {
      routerKind: 'App Router',
      routePath: '/api/user/delete',
      routeType: 'route',
    });

    const [, properties] = mockCaptureServerException.mock.calls[0];
    expect(properties).not.toHaveProperty('headers');
    expect(JSON.stringify(properties)).not.toContain('Bearer secret');
    expect(JSON.stringify(properties)).not.toContain('session=abc');
  });
});
