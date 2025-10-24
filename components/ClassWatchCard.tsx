'use client'

import { Database } from '@/lib/supabase/database.types'
import { ClassStateIndicator } from './ClassStateIndicator'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
import { Button } from './ui/button'
import { Trash2, RefreshCw } from 'lucide-react'
import { useState } from 'react'

type ClassWatch = Database['public']['Tables']['class_watches']['Row']
type ClassState = Database['public']['Tables']['class_states']['Row']

interface ClassWatchCardProps {
  watch: ClassWatch
  classState: ClassState | null
  onDelete: (watchId: string) => Promise<void>
}

export function ClassWatchCard({ watch, classState, onDelete }: ClassWatchCardProps) {
  const [isDeleting, setIsDeleting] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)

  const handleDelete = async () => {
    if (!confirm('Are you sure you want to stop watching this class?')) return

    setIsDeleting(true)
    try {
      await onDelete(watch.id)
    } catch (error) {
      console.error('Failed to delete watch:', error)
      alert('Failed to delete watch. Please try again.')
    } finally {
      setIsDeleting(false)
    }
  }

  const handleRefresh = async () => {
    setIsRefreshing(true)
    try {
      const response = await fetch('/api/class-watches/refresh', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          term: watch.term,
          class_nbr: watch.class_nbr,
        }),
      })

      if (!response.ok) {
        const errorData = await response.json() as { error?: string }
        throw new Error(errorData.error || 'Failed to refresh class details')
      }

      // Realtime subscription will automatically update the UI
      console.log('Class details refreshed successfully')
    } catch (error) {
      console.error('Failed to refresh class details:', error)
      alert(`Failed to refresh class details. ${error instanceof Error ? error.message : 'Please try again.'}`)
    } finally {
      setIsRefreshing(false)
    }
  }

  return (
    <Card className="relative">
      <CardHeader>
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <CardTitle className="text-lg">
              {watch.subject} {watch.catalog_nbr}
              {classState?.title && ` - ${classState.title}`}
            </CardTitle>
            <p className="text-sm text-zinc-600 dark:text-zinc-400 mt-1">
              Section {watch.class_nbr} • Term {watch.term}
            </p>
            {classState?.location && (
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                {classState.location}
                {classState.meeting_times && ` • ${classState.meeting_times}`}
              </p>
            )}
          </div>
          <div className="flex gap-1">
            <Button
              variant="ghost"
              size="icon"
              onClick={handleRefresh}
              disabled={isRefreshing}
              className="text-blue-600 hover:text-blue-700 hover:bg-blue-50 dark:hover:bg-blue-950"
              title="Refresh class details"
            >
              <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleDelete}
              disabled={isDeleting}
              className="text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950"
              title="Stop watching this class"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <ClassStateIndicator classState={classState} />
        {classState?.last_checked_at && (
          <p className="text-xs text-zinc-500 dark:text-zinc-500 mt-3">
            Last checked: {new Date(classState.last_checked_at).toLocaleString()}
          </p>
        )}
      </CardContent>
    </Card>
  )
}
