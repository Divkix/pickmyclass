import { Link } from "@tanstack/react-router";
import { Header } from "@/components/Header";
import { Button } from "@/components/ui/button";

export function NotFound() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <Header />
      <div className="flex flex-1 flex-col items-center justify-center p-4 text-center">
        <h1 className="text-6xl font-semibold text-foreground">404</h1>
        <h2 className="mt-4 text-2xl font-semibold text-foreground">Page Not Found</h2>
        <p className="mt-2 max-w-md text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <Button asChild size="lg" className="mt-8">
          <Link to="/">Back to Home</Link>
        </Button>
      </div>
    </div>
  );
}
