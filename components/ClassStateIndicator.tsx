import { Database } from '@/lib/supabase/database.types'

type ClassState = Database['public']['Tables']['class_states']['Row']

interface ClassStateIndicatorProps {
  classState: ClassState | null
}

export function ClassStateIndicator({ classState }: ClassStateIndicatorProps) {
  if (!classState) {
    return (
      <div className="inline-flex items-center gap-2 rounded-md bg-zinc-200 dark:bg-zinc-800 px-3 py-1 text-sm">
        <span className="h-2 w-2 rounded-full bg-zinc-500" />
        <span className="text-zinc-700 dark:text-zinc-300">Not yet checked</span>
      </div>
    )
  }

  const { seats_available, seats_capacity, instructor_name } = classState
  const hasSeats = seats_available > 0
  const hasInstructor = instructor_name && instructor_name !== 'Staff'

  return (
    <div className="flex flex-col gap-2">
      {/* Seats indicator */}
      <div
        className={`inline-flex items-center gap-2 rounded-md px-3 py-1 text-sm ${
          hasSeats
            ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-200'
            : 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-200'
        }`}
      >
        <span
          className={`h-2 w-2 rounded-full ${hasSeats ? 'bg-green-500' : 'bg-red-500'}`}
        />
        <span className="font-medium">
          {seats_available} of {seats_capacity} seats available
        </span>
      </div>

      {/* Instructor indicator */}
      <div
        className={`inline-flex items-center gap-2 rounded-md px-3 py-1 text-sm ${
          hasInstructor
            ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-200'
            : 'bg-zinc-200 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300'
        }`}
      >
        <span
          className={`h-2 w-2 rounded-full ${hasInstructor ? 'bg-blue-500' : 'bg-zinc-500'}`}
        />
        <span>Instructor: {instructor_name || 'TBA'}</span>
      </div>
    </div>
  )
}
