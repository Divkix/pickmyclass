import type { ClassDetails } from '@/lib/types/class';
import type { ClassStateRow } from '@/lib/types/class-watch';

export interface ChangeResult {
  seatBecameAvailable: boolean;
  seatsFilled: boolean;
  instructorAssigned: boolean;
  newOpenSeats: number;
}

function getOpenSeats(
  state: Pick<ClassStateRow, 'non_reserved_seats' | 'seats_available'> | null
): number {
  if (!state) return 0;
  return state.non_reserved_seats ?? state.seats_available;
}

function getInstructor(state: Pick<ClassStateRow, 'instructor_name'> | null): string {
  return state?.instructor_name ?? 'Staff';
}

export function detectChanges(
  oldState: Pick<
    ClassStateRow,
    'non_reserved_seats' | 'seats_available' | 'instructor_name'
  > | null,
  newData: ClassDetails
): ChangeResult {
  const oldOpenSeats = getOpenSeats(oldState);
  const oldInstructor = getInstructor(oldState);

  const newOpenSeats = newData.non_reserved_seats ?? newData.seats_available ?? 0;

  return {
    seatBecameAvailable: oldOpenSeats === 0 && newOpenSeats > 0,
    seatsFilled: oldOpenSeats > 0 && newOpenSeats === 0,
    instructorAssigned:
      oldInstructor === 'Staff' &&
      newData.instructor_name !== undefined &&
      newData.instructor_name !== 'Staff',
    newOpenSeats,
  };
}
