'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useAuth } from '@/lib/contexts/AuthContext'
import { Header } from '@/components/Header'
import { AddClassWatch } from '@/components/AddClassWatch'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { ArrowLeft } from 'lucide-react'
import { redirect } from 'next/navigation'

interface ErrorResponse {
  error: string
}

export default function AddClassPage() {
  const { user, loading: authLoading } = useAuth()
  const router = useRouter()

  // Redirect to login if not authenticated
  useEffect(() => {
    if (!authLoading && !user) {
      redirect('/login')
    }
  }, [user, authLoading])

  // Handle adding a new watch
  const handleAddWatch = async (watchData: {
    term: string
    class_nbr: string
  }) => {
    const response = await fetch('/api/class-watches', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(watchData),
    })

    if (!response.ok) {
      const data = (await response.json()) as ErrorResponse
      throw new Error(data.error || 'Failed to add class watch')
    }

    // Navigate back to dashboard on success
    router.push('/dashboard')
  }

  // Show loading state while checking auth
  if (authLoading) {
    return (
      <div className="flex min-h-screen flex-col bg-background">
        <Header />
        <div className="container mx-auto px-4 py-8 max-w-4xl">
          <Skeleton className="h-8 w-64 mb-6" />
          <Skeleton className="h-96 w-full" />
        </div>
      </div>
    )
  }

  // User is not authenticated (will redirect)
  if (!user) {
    return null
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <Header />
      <div className="container mx-auto px-4 py-8 max-w-4xl">
        <div className="mb-6">
          <Link href="/dashboard">
            <Button variant="ghost" className="gap-2">
              <ArrowLeft className="h-4 w-4" />
              Back to Dashboard
            </Button>
          </Link>
        </div>

        <div className="mb-6">
          <h1 className="text-3xl font-bold mb-2">Add Class Watch</h1>
          <p className="text-zinc-600 dark:text-zinc-400">
            Add a new class to monitor for seat availability and instructor assignments.
          </p>
        </div>

        <AddClassWatch onAdd={handleAddWatch} />
      </div>
    </div>
  )
}
