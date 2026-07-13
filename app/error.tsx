'use client';

import { useEffect } from 'react';
import { Header } from '@/components/Header';
import { Button } from '@/components/ui/button';
import { log } from '@/lib/log';

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    log('ErrorBoundary').error('Unhandled error:', error);
  }, [error]);

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <Header />
      <div className="flex flex-1 flex-col items-center justify-center p-4 text-center">
        <h1 className="text-4xl font-semibold text-foreground sm:text-5xl">Something went wrong</h1>
        <p className="mt-4 max-w-md text-muted-foreground">
          An unexpected error occurred. Please try again or return to the homepage.
        </p>
        <Button onClick={reset} size="lg" className="mt-8">
          Try again
        </Button>
      </div>
    </div>
  );
}
