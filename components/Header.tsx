'use client';

import { LayoutDashboard, Menu, Shield, X } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { AuthButton } from '@/components/AuthButton';
import { Logo } from '@/components/Logo';
import { ThemeToggle } from '@/components/ThemeToggle';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/contexts/AuthContext';

const navLinks = [
  { label: 'Blog', href: '/blog' },
  { label: 'FAQ', href: '/faq' },
  { label: 'About', href: '/about' },
];

export function Header() {
  const { user, loading, isAdmin, checkingAdmin } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 border-b border-border/40 bg-background/80 backdrop-blur-lg">
      <div className="flex items-center justify-between px-4 py-3 sm:px-6 sm:py-4">
        <div className="flex items-center gap-2 sm:gap-4 lg:gap-6">
          <Link href="/" className="transition-opacity hover:opacity-80">
            <Logo variant="full" size="md" />
          </Link>
          {!loading && !checkingAdmin && user && (
            <Link href={isAdmin ? '/admin' : '/dashboard'}>
              <Button
                variant="ghost"
                size="sm"
                className="min-h-11 text-base"
                aria-label={isAdmin ? 'Go to admin panel' : 'Go to dashboard'}
              >
                {isAdmin ? (
                  <>
                    <Shield className="size-4" aria-hidden="true" />
                    <span className="hidden xs:inline">Admin</span>
                  </>
                ) : (
                  <>
                    <LayoutDashboard className="size-4" aria-hidden="true" />
                    <span className="hidden xs:inline">Dashboard</span>
                  </>
                )}
              </Button>
            </Link>
          )}
          <nav className="hidden items-center gap-1 md:flex" aria-label="Main navigation">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <AuthButton />
          <Button
            variant="ghost"
            size="icon"
            className="min-h-11 md:hidden"
            aria-label={mobileMenuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={mobileMenuOpen}
            aria-controls="mobile-nav"
            onClick={() => setMobileMenuOpen((open) => !open)}
          >
            {mobileMenuOpen ? (
              <X className="size-5" aria-hidden="true" />
            ) : (
              <Menu className="size-5" aria-hidden="true" />
            )}
          </Button>
        </div>
      </div>
      {mobileMenuOpen && (
        <nav
          id="mobile-nav"
          className="border-t border-border/40 px-4 py-2 md:hidden"
          aria-label="Mobile navigation"
        >
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              onClick={() => setMobileMenuOpen(false)}
              className="block rounded-md px-3 py-3 text-base font-medium text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
            >
              {link.label}
            </Link>
          ))}
        </nav>
      )}
    </header>
  );
}
