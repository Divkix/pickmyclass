import { beforeEach, describe, expect, it, vi } from 'vite-plus/test';

const { defaultInit, bundledInit, fullInit } = vi.hoisted(() => ({
  defaultInit: vi.fn(),
  bundledInit: vi.fn(),
  fullInit: vi.fn(),
}));

vi.mock('posthog-js/dist/exception-autocapture', () => ({}));

vi.mock('posthog-js/dist/module.no-external', () => ({
  default: { init: bundledInit },
}));

vi.mock('posthog-js/dist/module.full.no-external', () => ({
  default: { init: fullInit },
}));

describe('browser instrumentation', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('initializes the no-external PostHog client without the oversized full bundle', async () => {
    await import('../../instrumentation-client');

    expect(defaultInit).not.toHaveBeenCalled();
    expect(fullInit).not.toHaveBeenCalled();
    expect(bundledInit).toHaveBeenCalledWith(
      expect.stringMatching(/^phc_/),
      expect.objectContaining({
        api_host: 'https://s.pickmyclass.app',
        ui_host: 'https://us.posthog.com',
        defaults: '2026-05-30',
        capture_exceptions: true,
      })
    );
  });
});
