import { beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import { captureServerEvent, getPostHogClient } from '@/lib/posthog-server';

const { mockCapture, mockFlush, mockIdentify, mockPostHog, mockWarn } = vi.hoisted(() => ({
  mockCapture: vi.fn(),
  mockFlush: vi.fn(),
  mockIdentify: vi.fn(),
  mockPostHog: vi.fn(),
  mockWarn: vi.fn(),
}));

vi.mock('posthog-node', () => ({
  PostHog: class {
    constructor(...args: unknown[]) {
      mockPostHog(...args);
      return {
        capture: mockCapture,
        flush: mockFlush,
        identify: mockIdentify,
      };
    }
  },
}));

vi.mock('@/lib/log', () => ({
  log: vi.fn(() => ({ warn: mockWarn })),
}));

describe('server-side PostHog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFlush.mockResolvedValue(undefined);
  });

  it('reuses one client and configures bounded, retry-free requests', () => {
    expect(getPostHogClient()).toBe(getPostHogClient());
    expect(mockPostHog).toHaveBeenCalledTimes(1);
    expect(mockPostHog).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        disabled: true,
        fetchRetryCount: 0,
        flushAt: 1,
        flushInterval: 0,
        requestTimeout: 1_000,
      })
    );
  });

  it('captures, identifies when requested, and flushes the event', async () => {
    await captureServerEvent({
      distinctId: 'user-1',
      event: 'user_registered',
      properties: { auth_provider: 'email' },
      identify: { email: 'student@example.com' },
    });

    expect(mockCapture).toHaveBeenCalledWith({
      distinctId: 'user-1',
      event: 'user_registered',
      properties: { auth_provider: 'email' },
    });
    expect(mockIdentify).toHaveBeenCalledWith({
      distinctId: 'user-1',
      properties: { email: 'student@example.com' },
    });
    expect(mockFlush).toHaveBeenCalledOnce();
  });

  it('does not fail the application operation when analytics flushing fails', async () => {
    mockFlush.mockRejectedValueOnce(new Error('analytics unavailable'));

    await expect(
      captureServerEvent({ distinctId: 'user-1', event: 'class_watch_added' })
    ).resolves.toBeUndefined();
    expect(mockWarn).toHaveBeenCalledWith('Failed to flush analytics event:', expect.any(Error));
  });
});
