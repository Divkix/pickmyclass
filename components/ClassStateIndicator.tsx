import { CheckCircle, Clock, ExternalLink, XCircle } from 'lucide-react';
import type { Database } from '@/lib/supabase/database.types';
import { getRateMyProfessorUrl, isValidProfessorName } from '@/lib/utils/ratemyprofessor';

type ClassState = Database['public']['Tables']['class_states']['Row'];

interface ClassStateIndicatorProps {
  classState: ClassState | null;
}

export function ClassStateIndicator({ classState }: ClassStateIndicatorProps) {
  if (!classState) {
    return (
      <div className="inline-flex items-center gap-2 rounded-md bg-asu-gold/20 dark:bg-asu-gold/10 px-3 py-1 text-sm">
        <Clock className="h-4 w-4 text-asu-gold" aria-hidden="true" />
        <span className="text-foreground">Checking soon...</span>
      </div>
    );
  }

  const { seats_available, seats_capacity, instructor_name } = classState;
  const hasInstructor = instructor_name && instructor_name !== 'Staff';

  // Determine seat availability state: open or full
  let seatColor: string;
  let seatMessage: string;
  let SeatIcon: typeof CheckCircle;
  let ariaLabel: string;

  if (seats_available > 0) {
    // Seats available - GREEN
    seatColor = 'bg-success/20 text-success';
    SeatIcon = CheckCircle;
    seatMessage = `${seats_available} of ${seats_capacity} seats available`;
    ariaLabel = `Seats available: ${seats_available} of ${seats_capacity} seats available`;
  } else {
    // Completely full - RED
    seatColor = 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-200';
    SeatIcon = XCircle;
    seatMessage = `0 of ${seats_capacity} seats available`;
    ariaLabel = `Class is full: 0 of ${seats_capacity} seats available`;
  }

  return (
    <div className="flex flex-col gap-2">
      {/* Seats indicator */}
      <output
        className={`inline-flex items-center gap-2 rounded-md px-3 py-1 text-sm ${seatColor}`}
        aria-label={ariaLabel}
      >
        <SeatIcon className="h-4 w-4" aria-hidden="true" />
        <span className="font-medium">{seatMessage}</span>
      </output>

      {/* Instructor indicator */}
      <div
        className={`inline-flex items-center gap-2 rounded-md px-3 py-1 text-sm ${
          hasInstructor ? 'bg-info/20 text-primary' : 'bg-muted text-muted-foreground'
        }`}
      >
        <span
          className={`h-2 w-2 rounded-full ${hasInstructor ? 'bg-primary' : 'bg-muted-foreground'}`}
        />
        <span>Instructor: {instructor_name || 'TBA'}</span>
        {isValidProfessorName(instructor_name) && (
          <a
            href={getRateMyProfessorUrl(instructor_name) || '#'}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-1 inline-flex items-center gap-1 text-xs text-primary hover:text-primary/80 transition-colors"
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
