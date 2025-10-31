'use client'

import { Database } from '@/lib/supabase/database.types'
import { ClassStateIndicator } from './ClassStateIndicator'
import { ClassDetailsDialog } from './ClassDetailsDialog'
import { DeleteConfirmDialog } from './DeleteConfirmDialog'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
import { Button } from './ui/button'
import { Trash2, Info } from 'lucide-react'
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
  const [showDetails, setShowDetails] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  const handleDelete = async () => {
    setIsDeleting(true)
    try {
      await onDelete(watch.id)
    } catch (error) {
      console.error('Failed to delete watch:', error)
      alert('Failed to delete watch. Please try again.')
      setIsDeleting(false)
    }
  }

  const classTitle = `${watch.subject} ${watch.catalog_nbr}${classState?.title ? ` - ${classState.title}` : ''}`

  return (
    <>
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
                onClick={() => setShowDetails(true)}
                className="text-blue-600 hover:text-blue-700 hover:bg-blue-50 dark:hover:bg-blue-950"
                aria-label={`View class details for ${classTitle}`}
                title="View class details"
              >
                <Info className="h-4 w-4" aria-hidden="true" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setShowDeleteConfirm(true)}
                disabled={isDeleting}
                className="text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950"
                aria-label={`Stop watching ${classTitle}`}
                title="Stop watching this class"
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
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

      <ClassDetailsDialog
        watch={watch}
        classState={classState}
        open={showDetails}
        onOpenChange={setShowDetails}
      />

      <DeleteConfirmDialog
        open={showDeleteConfirm}
        onOpenChange={setShowDeleteConfirm}
        onConfirm={handleDelete}
        title="Stop watching this class?"
        description={`You will no longer receive notifications for ${classTitle}. You can always add it back later.`}
        confirmText="Stop Watching"
        isDeleting={isDeleting}
      />
    </>
  )
}
