'use client';

import { useEffect } from 'react';
import { captureAnalyticsError } from '@/lib/analytics/client';
import { log } from '@/lib/log';
import './globals.css';

// Replaces the root layout when it throws, so app/error.tsx never sees these errors.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    log('ErrorBoundary').error('Unhandled root error:', error);
    captureAnalyticsError(error, { boundary: 'global' });
  }, [error]);

  return (
    <html lang="en">
      <body>
        <main className="flex min-h-screen flex-col items-center justify-center bg-background p-4 text-center">
          <h1 className="text-4xl font-semibold text-foreground sm:text-5xl">
            Something went wrong
          </h1>
          <p className="mt-4 max-w-md text-muted-foreground">
            An unexpected error occurred. Please try again or return to the homepage.
          </p>
          <button
            type="button"
            onClick={reset}
            className="mt-8 rounded-md bg-primary px-6 py-3 font-medium text-primary-foreground"
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
