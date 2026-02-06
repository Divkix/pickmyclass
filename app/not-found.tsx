import type { Metadata } from 'next';
import Link from 'next/link';
import { Header } from '@/components/Header';
import { Button } from '@/components/ui/button';

export const metadata: Metadata = {
  title: 'Page Not Found',
};

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <Header />
      <div className="flex flex-1 flex-col items-center justify-center p-4 text-center">
        <h1 className="text-6xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-2xl font-semibold text-foreground">Page Not Found</h2>
        <p className="mt-2 max-w-md text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <Link href="/" className="mt-8">
          <Button size="lg">Back to Home</Button>
        </Link>
      </div>
    </div>
  );
}
