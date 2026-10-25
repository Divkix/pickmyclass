import { BookOpen, LayoutDashboard, Shield, Users } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { SignOutButton } from "@/components/admin/SignOutButton";
import { Logo } from "@/components/Logo";
import { PauseSessionReplay } from "@/components/telemetry/PauseSessionReplay";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Button } from "@/components/ui/button";
import { verifyAdmin } from "@/lib/auth/admin";
import { AdminNavigation } from "@/components/admin/AdminNavigation";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

interface AdminLayoutProps {
  children: React.ReactNode;
}

export default async function AdminLayout({ children }: AdminLayoutProps) {
  const adminUser = await verifyAdmin();
  const userEmail = adminUser.email || "Admin";

  return (
    // `rr-block` keeps admin DOM out of session replay if a recording is live.
    <div className="rr-block flex min-h-screen bg-background">
      <PauseSessionReplay />
      <aside className="hidden lg:flex w-64 flex-col border-r border-border bg-card">
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <Link href="/" className="transition-opacity hover:opacity-80">
            <Logo variant="full" size="sm" />
          </Link>
        </div>

        <div className="border-b border-border px-6 py-4">
          <div className="flex items-center gap-2 rounded-lg bg-primary/10 px-3 py-2">
            <Shield className="size-4 text-primary" />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-primary">Admin Panel</p>
              <p className="text-xs text-muted-foreground truncate">{userEmail}</p>
            </div>
          </div>
        </div>

        <nav className="flex-1 space-y-1 px-3 py-4">
          <AdminNavigation />
        </nav>

        <div className="border-t border-border px-3 py-4 space-y-2">
          <SignOutButton />
        </div>
      </aside>

      <div className="flex-1 flex flex-col">
        <header className="lg:hidden sticky top-0 z-50 flex items-center justify-between border-b border-border/40 bg-background/80 px-4 py-3 backdrop-blur-lg">
          <Link href="/" className="transition-opacity hover:opacity-80">
            <Logo variant="icon" size="sm" />
          </Link>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <SignOutButton variant="icon" />
          </div>
        </header>

        <header className="hidden lg:flex sticky top-0 z-50 items-center justify-between border-b border-border/40 bg-background/80 px-6 py-4 backdrop-blur-lg">
          <h1 className="text-2xl font-semibold">Admin Panel</h1>
          <ThemeToggle />
        </header>

        <div className="lg:hidden border-b border-border bg-card px-4 py-2">
          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
            <Shield className="size-3 text-primary" />
            <span className="truncate">{userEmail}</span>
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1">
            <Button asChild variant="ghost" size="sm" className="gap-2">
              <Link href="/admin">
                <LayoutDashboard className="size-4" />
                Dashboard
              </Link>
            </Button>
            <Button asChild variant="ghost" size="sm" className="gap-2">
              <Link href="/admin/classes">
                <BookOpen className="size-4" />
                Classes
              </Link>
            </Button>
            <Button asChild variant="ghost" size="sm" className="gap-2">
              <Link href="/admin/users">
                <Users className="size-4" />
                Users
              </Link>
            </Button>
          </div>
        </div>

        <main id="main" tabIndex={-1} className="flex-1 p-4 sm:p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
