import { beforeEach, describe, expect, it, vi } from 'vite-plus/test';

const { mockCapture, mockCaptureException, mockIdentify, mockReset, sharedState } = vi.hoisted(
  () => ({
    mockCapture: vi.fn(),
    mockCaptureException: vi.fn(),
    mockIdentify: vi.fn(),
    mockReset: vi.fn(),
    sharedState: { loaded: false },
  })
);

vi.mock('posthog-js/dist/module.no-external', () => ({
  default: {
    get __loaded() {
      return sharedState.loaded;
    },
    capture: mockCapture,
    captureException: mockCaptureException,
    identify: mockIdentify,
    reset: mockReset,
  },
}));

import {
  captureAnalyticsError,
  identifyAnalyticsUser,
  isAnalyticsInitialized,
  resetAnalyticsIdentity,
  trackAnalyticsEvent,
} from '@/lib/analytics/client';

describe('browser analytics boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sharedState.loaded = false;
  });

  it('reports initialization from the bundled PostHog singleton', () => {
    expect(isAnalyticsInitialized()).toBe(false);
    sharedState.loaded = true;
    expect(isAnalyticsInitialized()).toBe(true);
  });

  it('forwards typed events with their exact property payloads', () => {
    trackAnalyticsEvent('onboarding_popular_class_tracked', {
      class_nbr: '12345',
      term: '2267',
    });
    expect(mockCapture).toHaveBeenCalledWith('onboarding_popular_class_tracked', {
      class_nbr: '12345',
      term: '2267',
    });
  });

  it('passes an empty object for no-property events', () => {
    trackAnalyticsEvent('user_logged_out', {});
    expect(mockCapture).toHaveBeenCalledWith('user_logged_out', {});
    expect(mockCapture.mock.calls[0][1]).toEqual({});
  });

  it('identifies with the stable app user id and optional traits', () => {
    identifyAnalyticsUser('legacy-supabase-uuid', { email: 'student@example.com' });
    expect(mockIdentify).toHaveBeenCalledWith('legacy-supabase-uuid', {
      email: 'student@example.com',
    });

    identifyAnalyticsUser('user_clerk_123');
    expect(mockIdentify).toHaveBeenCalledWith('user_clerk_123', undefined);
  });

  it('resets the identity on logout or account deletion', () => {
    resetAnalyticsIdentity();
    expect(mockReset).toHaveBeenCalledTimes(1);
  });

  it('captures errors for Error Tracking without failing the caller', () => {
    const failure = new Error('boundary exploded');
    captureAnalyticsError(failure, { boundary: 'app' });
    expect(mockCaptureException).toHaveBeenCalledWith(failure, { boundary: 'app' });

    captureAnalyticsError('string failure');
    expect(mockCaptureException).toHaveBeenCalledWith('string failure', undefined);
  });
});
