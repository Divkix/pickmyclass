import { Database } from '@/lib/supabase/database.types';
import { ExternalLink, CheckCircle, AlertCircle, XCircle, HelpCircle } from 'lucide-react';
import { getRateMyProfessorUrl, isValidProfessorName } from '@/lib/utils/ratemyprofessor';

type ClassState = Database['public']['Tables']['class_states']['Row'];

interface ClassStateIndicatorProps {
  classState: ClassState | null;
}

export function ClassStateIndicator({ classState }: ClassStateIndicatorProps) {
  if (!classState) {
    return (
      <div className="inline-flex items-center gap-2 rounded-md bg-zinc-200 dark:bg-zinc-800 px-3 py-1 text-sm">
        <span className="h-2 w-2 rounded-full bg-zinc-500" />
        <span className="text-zinc-700 dark:text-zinc-300">Not yet checked</span>
      </div>
    );
  }

  const { seats_available, seats_capacity, non_reserved_seats, instructor_name } = classState;
  const hasInstructor = instructor_name && instructor_name !== 'Staff';

  // Determine seat availability state with 4 cases
  let seatState: 'open' | 'reserved-only' | 'full' | 'unknown';
  let seatColor: string;
  let seatMessage: string;
  let SeatIcon: typeof CheckCircle;
  let ariaLabel: string;

  if (non_reserved_seats === null) {
    // Case 1: Reserved seat data unavailable (scraper failure or no data)
    seatState = 'unknown';
    SeatIcon = HelpCircle;
    if (seats_available > 0) {
      seatColor = 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-200';
      seatMessage = `${seats_available} of ${seats_capacity} seats available`;
      ariaLabel = `Unknown seat status: ${seats_available} of ${seats_capacity} seats available, reserved seat data unavailable`;
    } else {
      seatColor = 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-200';
      seatMessage = `0 of ${seats_capacity} seats available`;
      ariaLabel = `Class is full: 0 of ${seats_capacity} seats available`;
    }
  } else if (non_reserved_seats > 0) {
    // Case 2: Truly open (non-reserved) seats available - GREEN
    seatState = 'open';
    seatColor = 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-200';
    SeatIcon = CheckCircle;
    const reservedCount = seats_available - non_reserved_seats;
    if (reservedCount > 0) {
      seatMessage = `${non_reserved_seats} open seat${non_reserved_seats > 1 ? 's' : ''} (${reservedCount} reserved)`;
      ariaLabel = `Seats available: ${non_reserved_seats} open seat${non_reserved_seats > 1 ? 's' : ''}, ${reservedCount} reserved seat${reservedCount > 1 ? 's' : ''}`;
    } else {
      seatMessage = `${non_reserved_seats} of ${seats_capacity} seats available`;
      ariaLabel = `Seats available: ${non_reserved_seats} of ${seats_capacity} seats available`;
    }
  } else if (seats_available > 0) {
    // Case 3: Only reserved seats available - ORANGE
    seatState = 'reserved-only';
    seatColor = 'bg-orange-100 dark:bg-orange-900/30 text-orange-800 dark:text-orange-200';
    SeatIcon = AlertCircle;
    seatMessage = `${seats_available} seat${seats_available > 1 ? 's' : ''} available (all reserved)`;
    ariaLabel = `Reserved seats only: ${seats_available} seat${seats_available > 1 ? 's' : ''} available, all are reserved`;
  } else {
    // Case 4: Completely full - RED
    seatState = 'full';
    seatColor = 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-200';
    SeatIcon = XCircle;
    seatMessage = `0 of ${seats_capacity} seats available`;
    ariaLabel = `Class is full: 0 of ${seats_capacity} seats available`;
  }

  return (
    <div className="flex flex-col gap-2">
      {/* Seats indicator with 4-state color system */}
      <div
        className={`inline-flex items-center gap-2 rounded-md px-3 py-1 text-sm ${seatColor}`}
        aria-label={ariaLabel}
        role="status"
      >
        <SeatIcon className="h-4 w-4" aria-hidden="true" />
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
        <span className={`h-2 w-2 rounded-full ${hasInstructor ? 'bg-blue-500' : 'bg-zinc-500'}`} />
        <span>Instructor: {instructor_name || 'TBA'}</span>
        {isValidProfessorName(instructor_name) && (
          <a
            href={getRateMyProfessorUrl(instructor_name) || '#'}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-1 inline-flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 transition-colors"
            aria-label={`View ${instructor_name} on RateMyProfessor`}
            title="View on RateMyProfessor"
            onClick={(e) => e.stopPropagation()}
          >
            <ExternalLink className="h-3 w-3" aria-hidden="true" />
            <span className="hover:underline">RMP</span>
          </a>
        )}
      </div>
    </div>
  );
}
