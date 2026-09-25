import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vite-plus/test';
import GlobalError from '@/app/global-error';

const { mockCapture } = vi.hoisted(() => ({ mockCapture: vi.fn() }));

vi.mock('@/lib/analytics/client', () => ({ captureAnalyticsError: mockCapture }));

vi.mock('@/lib/log', () => ({ log: () => ({ error: vi.fn() }) }));

vi.mock('@/app/globals.css', () => ({}));

describe('GlobalError', () => {
  it('reports the error to PostHog with the global boundary tag', () => {
    const error = new Error('root layout failed');

    render(<GlobalError error={error} reset={vi.fn()} />, { container: document.documentElement });

    expect(mockCapture).toHaveBeenCalledWith(error, { boundary: 'global' });
  });

  it('calls reset when the user retries', () => {
    const reset = vi.fn();

    render(<GlobalError error={new Error('x')} reset={reset} />, {
      container: document.documentElement,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(reset).toHaveBeenCalledTimes(1);
  });
});
