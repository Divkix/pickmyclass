import { type ErrorComponentProps, useRouter } from "@tanstack/react-router";
import { useEffect } from "react";
import { Header } from "@/components/Header";
import { Button } from "@/components/ui/button";
import { errorFields, log } from "@/lib/log";
import { recordBrowserError } from "@/lib/telemetry/browser";

export function ErrorPage({ error }: ErrorComponentProps) {
  const router = useRouter();

  useEffect(() => {
    log("ErrorBoundary").error("Unhandled error", errorFields(error));
    recordBrowserError(error, { boundary: "app" });
  }, [error]);

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <Header />
      <div className="flex flex-1 flex-col items-center justify-center p-4 text-center">
        <h1 className="text-4xl font-semibold text-foreground sm:text-5xl">Something went wrong</h1>
        <p className="mt-4 max-w-md text-muted-foreground">
          An unexpected error occurred. Please try again or return to the homepage.
        </p>
        {/* Re-runs the loaders and clears the error boundary. */}
        <Button onClick={() => router.invalidate()} size="lg" className="mt-8">
          Try again
        </Button>
      </div>
    </div>
  );
}
