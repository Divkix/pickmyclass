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

  const { seats_available, seats_capacity, non_reserved_seats, instructor_name } = classState
  const hasInstructor = instructor_name && instructor_name !== 'Staff'

  // Determine seat availability state with 4 cases
  let seatState: 'open' | 'reserved-only' | 'full' | 'unknown'
  let seatColor: string
  let seatDotColor: string
  let seatMessage: string

  if (non_reserved_seats === null) {
    // Case 1: Reserved seat data unavailable (scraper failure or no data)
    seatState = 'unknown'
    if (seats_available > 0) {
      seatColor = 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-200'
      seatDotColor = 'bg-yellow-500'
      seatMessage = `${seats_available} of ${seats_capacity} seats available`
    } else {
      seatColor = 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-200'
      seatDotColor = 'bg-red-500'
      seatMessage = `0 of ${seats_capacity} seats available`
    }
  } else if (non_reserved_seats > 0) {
    // Case 2: Truly open (non-reserved) seats available - GREEN
    seatState = 'open'
    seatColor = 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-200'
    seatDotColor = 'bg-green-500'
    const reservedCount = seats_available - non_reserved_seats
    if (reservedCount > 0) {
      seatMessage = `${non_reserved_seats} open seat${non_reserved_seats > 1 ? 's' : ''} (${reservedCount} reserved)`
    } else {
      seatMessage = `${non_reserved_seats} of ${seats_capacity} seats available`
    }
  } else if (seats_available > 0) {
    // Case 3: Only reserved seats available - ORANGE
    seatState = 'reserved-only'
    seatColor = 'bg-orange-100 dark:bg-orange-900/30 text-orange-800 dark:text-orange-200'
    seatDotColor = 'bg-orange-500'
    seatMessage = `${seats_available} seat${seats_available > 1 ? 's' : ''} available (all reserved)`
  } else {
    // Case 4: Completely full - RED
    seatState = 'full'
    seatColor = 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-200'
    seatDotColor = 'bg-red-500'
    seatMessage = `0 of ${seats_capacity} seats available`
  }

  return (
    <div className="flex flex-col gap-2">
      {/* Seats indicator with 4-state color system */}
      <div className={`inline-flex items-center gap-2 rounded-md px-3 py-1 text-sm ${seatColor}`}>
        <span className={`h-2 w-2 rounded-full ${seatDotColor}`} />
        <span className="font-medium">{seatMessage}</span>
      </div>

      {/* Warning badge for unknown reserved status */}
      {seatState === 'unknown' && seats_available > 0 && (
        <div className="inline-flex items-center gap-1 text-xs text-yellow-700 dark:text-yellow-300">
          <span>⚠️</span>
          <span>Reserved seat status unknown - verify before enrolling</span>
        </div>
      )}

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
