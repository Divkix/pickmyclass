/**
 * Change Detector
 *
 * Pure function that compares old and new class section data.
 * No I/O — just comparison logic.
 *
 * Uses non-reserved seats as the primary seat count signal.
 * When oldState is null (first observation), treats baseline as:
 * - seats_available = 0 (full)
 * - instructor = 'Staff'
 */

import type { ClassDetails } from '@/lib/types/class';
import type { ClassStateRow } from '@/lib/types/class-watch';

/**
 * What changed between observations of a section.
 * All fields are independent flags — the caller decides what to do.
 */
export interface ChangeResult {
  /** Non-reserved seats went from 0 → >0 */
  seatBecameAvailable: boolean;
  /** Non-reserved seats went from >0 → 0 */
  seatsFilled: boolean;
  /** Instructor changed from 'Staff' to a named professor */
  instructorAssigned: boolean;
  /** Current count of open (non-reserved) seats */
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

/**
 * Detect changes between old and new class section data.
 *
 * @param oldState - Previous known state (null = first observation)
 * @param newData - Fresh data from ASU API
 * @returns ChangeResult with change flags
 */
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
      newData.instructor !== undefined &&
      newData.instructor !== 'Staff',
    newOpenSeats,
  };
}
