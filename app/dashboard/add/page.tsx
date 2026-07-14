'use client';

import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import posthog from 'posthog-js';
import { AddClassWatch } from '@/components/AddClassWatch';
import { Header } from '@/components/Header';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/lib/contexts/AuthContext';
import type { ClassWatchCreationInput } from '@/lib/class-watches/class-watch-creation';
import type { ClassWatchRow } from '@/lib/types/class-watch';

export default function AddClassPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();

  // Redirect to login if not authenticated
  useEffect(() => {
    if (!authLoading && !user) {
      router.replace('/login');
    }
  }, [user, authLoading, router]);

  const handleWatchCreated = (_watch: ClassWatchRow, watchData: ClassWatchCreationInput) => {
    posthog.capture('class_watch_added', {
      term: watchData.term,
      class_nbr: watchData.class_nbr,
    });

    // Navigate back to dashboard on success
    router.push('/dashboard');
  };

  // Show loading state while checking auth
  if (authLoading) {
    return (
      <div className="flex min-h-screen flex-col bg-background">
        <Header />
        <div className="container mx-auto px-4 py-8 max-w-4xl">
          <Skeleton className="h-8 w-64 mb-6" />
          <Skeleton className="h-96 w-full" />
        </div>
      </div>
    );
  }

  // User is not authenticated (will redirect)
  if (!user) {
    return null;
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <Header />
      <div className="container mx-auto px-4 py-8 max-w-4xl">
        <div className="mb-6">
          <Link href="/dashboard">
            <Button variant="ghost" className="gap-2">
              <ArrowLeft className="size-4" />
              Back to Dashboard
            </Button>
          </Link>
        </div>

        <div className="mb-6">
          <h1 className="text-3xl font-semibold mb-2">Add a Class to Watch</h1>
          <p className="text-zinc-600 dark:text-zinc-400">
            Enter your section number and we'll start watching it. Simple as that.
          </p>
        </div>

        <AddClassWatch onCreated={handleWatchCreated} />
      </div>
    </div>
  );
}
