'use client'

import Link from 'next/link'
import { useAuth } from '@/lib/contexts/AuthContext'
import AuthButton from '@/components/AuthButton'
import { ThemeToggle } from '@/components/ThemeToggle'
import { Button } from '@/components/ui/button'
import { Logo } from '@/components/Logo'
import { LayoutDashboard } from 'lucide-react'

export function Header() {
  const { user, loading } = useAuth()

  return (
    <header className="sticky top-0 z-50 flex items-center justify-between border-b border-border/40 bg-background/80 px-4 py-3 backdrop-blur-lg sm:px-6 sm:py-4">
      <div className="flex items-center gap-4 sm:gap-6">
        <Link href="/" className="transition-opacity hover:opacity-80">
          <Logo variant="full" size="md" />
        </Link>
        {!loading && user && (
          <Link href="/dashboard">
            <Button variant="ghost" size="sm" className="text-base" aria-label="Go to dashboard">
              <LayoutDashboard className="size-4" aria-hidden="true" />
              Dashboard
            </Button>
          </Link>
        )}
      </div>
      <div className="flex items-center gap-2">
        <ThemeToggle />
        <AuthButton />
      </div>
    </header>
  )
}
