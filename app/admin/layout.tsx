import { BookOpen, LayoutDashboard, Shield, Users } from 'lucide-react';
import Link from 'next/link';
import { SignOutButton } from '@/components/admin/SignOutButton';
import { Logo } from '@/components/Logo';
import { ThemeToggle } from '@/components/ThemeToggle';
import { Button } from '@/components/ui/button';
import { verifyAdmin } from '@/lib/auth/admin';
import { createClient } from '@/lib/supabase/server';
import { AdminNavigation } from './AdminNavigation';

interface AdminLayoutProps {
  children: React.ReactNode;
}

/**
 * Admin Layout Component
 *
 * Server Component that:
 * 1. Verifies admin access via verifyAdmin()
 * 2. Provides admin navigation sidebar/header
 * 3. Shows admin user email
 * 4. Includes dark mode support
 *
 * Protected routes under /admin/*
 */
export default async function AdminLayout({ children }: AdminLayoutProps) {
  // Verify admin access - will redirect if not admin
  await verifyAdmin();

  // Get user email for display
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const userEmail = user?.email || 'Admin';

  return (
    <div className="flex min-h-screen bg-background">
      {/* Sidebar Navigation */}
      <aside className="hidden lg:flex w-64 flex-col border-r border-border bg-card">
        {/* Sidebar Header */}
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <Link href="/" className="transition-opacity hover:opacity-80">
            <Logo variant="full" size="sm" />
          </Link>
        </div>

        {/* Admin Badge */}
        <div className="border-b border-border px-6 py-4">
          <div className="flex items-center gap-2 rounded-lg bg-primary/10 px-3 py-2">
            <Shield className="size-4 text-primary" />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-primary">Admin Panel</p>
              <p className="text-xs text-muted-foreground truncate">{userEmail}</p>
            </div>
          </div>
        </div>

        {/* Navigation Links */}
        <nav className="flex-1 space-y-1 px-3 py-4">
          <AdminNavigation />
        </nav>

        {/* Sidebar Footer */}
        <div className="border-t border-border px-3 py-4 space-y-2">
          <SignOutButton />
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col">
        {/* Mobile Header */}
        <header className="lg:hidden sticky top-0 z-50 flex items-center justify-between border-b border-border/40 bg-background/80 px-4 py-3 backdrop-blur-lg">
          <Link href="/" className="transition-opacity hover:opacity-80">
            <Logo variant="icon" size="sm" />
          </Link>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <SignOutButton variant="icon" />
          </div>
        </header>

        {/* Desktop Header */}
        <header className="hidden lg:flex sticky top-0 z-50 items-center justify-between border-b border-border/40 bg-background/80 px-6 py-4 backdrop-blur-lg">
          <h1 className="text-2xl font-bold">Admin Panel</h1>
          <ThemeToggle />
        </header>

        {/* Mobile Navigation (Bottom Sheet - Simplified) */}
        <div className="lg:hidden border-b border-border bg-card px-4 py-2">
          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
            <Shield className="size-3 text-primary" />
            <span className="truncate">{userEmail}</span>
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1">
            <Link href="/admin">
              <Button variant="ghost" size="sm" className="gap-2">
                <LayoutDashboard className="size-4" />
                Dashboard
              </Button>
            </Link>
            <Link href="/admin/classes">
              <Button variant="ghost" size="sm" className="gap-2">
                <BookOpen className="size-4" />
                Classes
              </Button>
            </Link>
            <Link href="/admin/users">
              <Button variant="ghost" size="sm" className="gap-2">
                <Users className="size-4" />
                Users
              </Button>
            </Link>
          </div>
        </div>

        {/* Page Content */}
        <main className="flex-1 p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}
