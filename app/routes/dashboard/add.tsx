import { ArrowLeft } from "lucide-react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { AddClassWatch } from "@/components/AddClassWatch";
import { Header } from "@/components/Header";
import { Button } from "@/components/ui/button";
import { requirePageAccess } from "@/lib/auth/page-access";

const loadAddClass = createServerFn().handler(async () => {
  await requirePageAccess("/dashboard/add");
});

export const Route = createFileRoute("/dashboard/add")({
  loader: () => loadAddClass(),
  component: AddClassPage,
});

function AddClassPage() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <Header />
      <main id="main" tabIndex={-1} className="container mx-auto px-4 py-8 max-w-4xl">
        <div className="mb-6">
          <Button asChild variant="ghost" className="gap-2">
            <Link to="/dashboard">
              <ArrowLeft className="size-4" />
              Back to Dashboard
            </Link>
          </Button>
        </div>

        <div className="mb-6">
          <h1 className="text-3xl font-semibold mb-2">Add a Class to Watch</h1>
          <p className="text-zinc-600 dark:text-zinc-400">
            Enter the 5-digit class number and pick the term. We will start watching the class.
          </p>
        </div>

        <AddClassWatch />
      </main>
    </div>
  );
}
