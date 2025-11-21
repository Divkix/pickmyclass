'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/contexts/AuthContext'
import { Button } from '@/components/ui/button'
import { LogOut } from 'lucide-react'
import { cn } from '@/lib/utils'

interface SignOutButtonProps {
  variant?: 'full' | 'icon'
  className?: string
}

export function SignOutButton({ variant = 'full', className }: SignOutButtonProps) {
  const router = useRouter()
  const { signOut } = useAuth()
  const [isLoading, setIsLoading] = useState(false)

  const handleSignOut = async () => {
    try {
      setIsLoading(true)
      await signOut()
      router.push('/login')
    } catch (error) {
      console.error('Error signing out:', error)
    } finally {
      setIsLoading(false)
    }
  }

  if (variant === 'icon') {
    return (
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={handleSignOut}
        disabled={isLoading}
        className={cn('', className)}
        title="Sign Out"
      >
        <LogOut className="size-4" />
      </Button>
    )
  }

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handleSignOut}
      disabled={isLoading}
      className={cn('w-full justify-start gap-2', className)}
    >
      <LogOut className="size-4" />
      {isLoading ? 'Signing out...' : 'Sign Out'}
    </Button>
  )
}
