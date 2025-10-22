'use client'

import Link from 'next/link'
import AuthButton from '@/components/AuthButton'

export function Header() {
  return (
    <header className="flex items-center justify-between border-b border-border bg-card px-6 py-4">
      <Link href="/">
        <h1 className="text-xl font-bold text-foreground hover:text-muted-foreground transition-colors">
          PickMyClass
        </h1>
      </Link>
      <AuthButton />
    </header>
  )
}
