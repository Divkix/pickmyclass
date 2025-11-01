'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useAuth } from '@/lib/contexts/AuthContext'
import { createClient } from '@/lib/supabase/client'
import AuthButton from '@/components/AuthButton'
import { ThemeToggle } from '@/components/ThemeToggle'
import { Button } from '@/components/ui/button'
import { Logo } from '@/components/Logo'
import { LayoutDashboard, Shield } from 'lucide-react'

export function Header() {
  const { user, loading } = useAuth()
  const [isAdmin, setIsAdmin] = useState<boolean>(false)
  const [checkingAdmin, setCheckingAdmin] = useState(true)

  // Fetch admin status when user changes
  useEffect(() => {
    async function checkAdminStatus() {
      if (!user) {
        setIsAdmin(false)
        setCheckingAdmin(false)
        return
      }

      try {
        const supabase = createClient()
        const { data: profile } = await supabase
          .from('user_profiles')
          .select('is_admin')
          .eq('user_id', user.id)
          .single()

        setIsAdmin(profile?.is_admin ?? false)
      } catch (error) {
        console.error('Error checking admin status:', error)
        setIsAdmin(false)
      } finally {
        setCheckingAdmin(false)
      }
    }

    checkAdminStatus()
  }, [user])

  return (
    <header className="sticky top-0 z-50 flex items-center justify-between border-b border-border/40 bg-background/80 px-4 py-3 backdrop-blur-lg sm:px-6 sm:py-4">
      <div className="flex items-center gap-4 sm:gap-6">
        <Link href="/" className="transition-opacity hover:opacity-80">
          <Logo variant="full" size="md" />
        </Link>
        {!loading && !checkingAdmin && user && (
          <Link href={isAdmin ? '/admin' : '/dashboard'}>
            <Button variant="ghost" size="sm" className="text-base" aria-label={isAdmin ? 'Go to admin panel' : 'Go to dashboard'}>
              {isAdmin ? (
                <>
                  <Shield className="size-4" aria-hidden="true" />
                  Admin
                </>
              ) : (
                <>
                  <LayoutDashboard className="size-4" aria-hidden="true" />
                  Dashboard
                </>
              )}
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
