'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useAuth } from '@/lib/contexts/AuthContext'
import { useRealtimeClassStates } from '@/lib/hooks/useRealtimeClassStates'
import { Header } from '@/components/Header'
import { ClassWatchCard } from '@/components/ClassWatchCard'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Alert } from '@/components/ui/alert'
import { Database } from '@/lib/supabase/database.types'
import { redirect } from 'next/navigation'
import { Plus } from 'lucide-react'

type ClassWatch = Database['public']['Tables']['class_watches']['Row'] & {
  class_state?: Database['public']['Tables']['class_states']['Row'] | null
}

interface GetClassWatchesResponse {
  watches: ClassWatch[]
  maxWatches: number
}

export default function DashboardPage() {
  const { user, loading: authLoading } = useAuth()
  const [watches, setWatches] = useState<ClassWatch[]>([])
  const [maxWatches, setMaxWatches] = useState<number>(10)
  const [isLoadingWatches, setIsLoadingWatches] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Get class numbers from watches for Realtime subscription
  const classNumbers = watches.map((w) => w.class_nbr)

  // Subscribe to real-time updates
  const { classStates, loading: realtimeLoading } = useRealtimeClassStates({
    classNumbers,
    enabled: classNumbers.length > 0,
  })

  // Redirect to login if not authenticated
  useEffect(() => {
    if (!authLoading && !user) {
      redirect('/login')
    }
  }, [user, authLoading])

  // Fetch user's class watches
  const fetchWatches = async () => {
    try {
      setIsLoadingWatches(true)
      setError(null)

      const response = await fetch('/api/class-watches')
      if (!response.ok) {
        throw new Error('Failed to fetch class watches')
      }

      const data = (await response.json()) as GetClassWatchesResponse
      setWatches(data.watches || [])
      setMaxWatches(data.maxWatches || 10)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load class watches')
    } finally {
      setIsLoadingWatches(false)
    }
  }

  useEffect(() => {
    if (user) {
      fetchWatches()
    }
  }, [user])

  // Handle deleting a watch
  const handleDeleteWatch = async (watchId: string) => {
    const response = await fetch(`/api/class-watches?id=${watchId}`, {
      method: 'DELETE',
    })

    if (!response.ok) {
      throw new Error('Failed to delete class watch')
    }

    // Remove from local state immediately
    setWatches((prev) => prev.filter((w) => w.id !== watchId))
  }

  // Show loading state while checking auth
  if (authLoading) {
    return (
      <div className="flex min-h-screen flex-col bg-background">
        <Header />
        <div className="container mx-auto px-4 py-8 max-w-4xl">
          <Skeleton className="h-8 w-64 mb-6" />
          <Skeleton className="h-32 w-full mb-4" />
          <Skeleton className="h-48 w-full" />
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
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">Class Watch Dashboard</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          Monitor University classes for seat availability and instructor assignments.
        </p>
      </div>

      {error && (
        <Alert className="mb-6 bg-red-50 dark:bg-red-950 text-red-800 dark:text-red-200 border-red-200 dark:border-red-800">
          {error}
        </Alert>
      )}

      {/* Add new watch button */}
      <div className="mb-6">
        <Link href="/dashboard/add">
          <Button className="w-full gap-2">
            <Plus className="h-4 w-4" />
            Add Class to Watch
          </Button>
        </Link>
      </div>

      {/* Loading state */}
      {isLoadingWatches && (
        <div className="space-y-4">
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      )}

      {/* Empty state */}
      {!isLoadingWatches && watches.length === 0 && (
        <div className="text-center py-12 bg-zinc-50 dark:bg-zinc-900 rounded-lg border-2 border-dashed border-zinc-200 dark:border-zinc-800">
          <p className="text-zinc-600 dark:text-zinc-400 mb-2">No class watches yet</p>
          <p className="text-sm text-zinc-500 dark:text-zinc-500">
            Add a class above to start monitoring for seat availability.
          </p>
        </div>
      )}

      {/* Class watches list */}
      {!isLoadingWatches && watches.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold">
              Your Watches ({watches.length}/{maxWatches})
            </h2>
            {realtimeLoading && (
              <span className="text-sm text-zinc-500 dark:text-zinc-500 animate-pulse">
                Syncing...
              </span>
            )}
          </div>

          {watches.map((watch) => {
            // Use real-time state if available, otherwise use the initial state
            const liveState = classStates[watch.class_nbr] || watch.class_state || null

            return (
              <ClassWatchCard
                key={watch.id}
                watch={watch}
                classState={liveState}
                onDelete={handleDeleteWatch}
              />
            )
          })}
        </div>
      )}
      </div>
    </div>
  )
}
