'use client'

import Link from 'next/link'
import { useAuth } from '@/lib/contexts/AuthContext'
import AuthButton from '@/components/AuthButton'
import { Button } from '@/components/ui/button'

export function Header() {
  const { user, loading } = useAuth()

  return (
    <header className="flex items-center justify-between border-b border-border bg-card px-6 py-4">
      <div className="flex items-center gap-6">
        <Link href="/">
          <h1 className="text-xl font-bold text-foreground hover:text-muted-foreground transition-colors">
            PickMyClass
          </h1>
        </Link>
        {!loading && user && (
          <Link href="/dashboard">
            <Button variant="ghost" className="text-base">
              Dashboard
            </Button>
          </Link>
        )}
      </div>
      <AuthButton />
    </header>
  )
}
