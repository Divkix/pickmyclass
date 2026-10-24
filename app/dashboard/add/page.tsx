import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { AddClassWatch } from "@/components/AddClassWatch";
import { Header } from "@/components/Header";
import { Button } from "@/components/ui/button";

export default function AddClassPage() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <Header />
      <main id="main" tabIndex={-1} className="container mx-auto px-4 py-8 max-w-4xl">
        <div className="mb-6">
          <Button asChild variant="ghost" className="gap-2">
            <Link href="/dashboard">
              <ArrowLeft className="size-4" />
              Back to Dashboard
            </Link>
          </Button>
        </div>

        <div className="mb-6">
          <h1 className="text-3xl font-semibold mb-2">Add a Class to Watch</h1>
          <p className="text-zinc-600 dark:text-zinc-400">
            Enter your section number and we'll start watching it. Simple as that.
          </p>
        </div>

        <AddClassWatch />
      </main>
    </div>
  );
}
