import { describe, expect, it } from 'vite-plus/test';
import { detectChanges } from '@/lib/queue/change-detector';
import type { ClassDetails } from '@/lib/types/class';
import type { ClassStateRow } from '@/lib/types/class-watch';

function mockClassDetails(overrides: Partial<ClassDetails> = {}): ClassDetails {
  return {
    subject: 'CSE',
    catalog_nbr: '110',
    title: 'Principles of Programming',
    instructor_name: 'Staff',
    seats_available: 0,
    seats_capacity: 100,
    non_reserved_seats: null,
    location: 'TBD',
    meeting_times: 'TBD',
    ...overrides,
  };
}

function mockOldState(
  overrides: Partial<
    Pick<ClassStateRow, 'non_reserved_seats' | 'seats_available' | 'instructor_name'>
  > = {}
): Pick<ClassStateRow, 'non_reserved_seats' | 'seats_available' | 'instructor_name'> {
  return {
    non_reserved_seats: 0,
    seats_available: 0,
    instructor_name: 'Staff',
    ...overrides,
  };
}

describe('detectChanges', () => {
  it('first observation with full section returns no changes', () => {
    const result = detectChanges(null, mockClassDetails());

    expect(result).toEqual({
      seatBecameAvailable: false,
      seatsFilled: false,
      instructorAssigned: false,
      newOpenSeats: 0,
    });
  });

  it('first observation with open seats returns seat became available', () => {
    const result = detectChanges(
      null,
      mockClassDetails({ seats_available: 5, non_reserved_seats: 3 })
    );

    expect(result).toEqual({
      seatBecameAvailable: true,
      seatsFilled: false,
      instructorAssigned: false,
      newOpenSeats: 3,
    });
  });

  it('old full to new open sets seatBecameAvailable', () => {
    const oldState = mockOldState({ non_reserved_seats: 0, seats_available: 0 });
    const result = detectChanges(
      oldState,
      mockClassDetails({ seats_available: 5, non_reserved_seats: 3 })
    );

    expect(result).toEqual({
      seatBecameAvailable: true,
      seatsFilled: false,
      instructorAssigned: false,
      newOpenSeats: 3,
    });
  });

  it('old open to new full sets seatsFilled', () => {
    const oldState = mockOldState({ non_reserved_seats: 3, seats_available: 5 });
    const result = detectChanges(
      oldState,
      mockClassDetails({ seats_available: 0, non_reserved_seats: 0 })
    );

    expect(result).toEqual({
      seatBecameAvailable: false,
      seatsFilled: true,
      instructorAssigned: false,
      newOpenSeats: 0,
    });
  });

  it('old full to new full (no change) returns all false', () => {
    const oldState = mockOldState({ non_reserved_seats: 0, seats_available: 0 });
    const result = detectChanges(
      oldState,
      mockClassDetails({ seats_available: 0, non_reserved_seats: 0 })
    );

    expect(result).toEqual({
      seatBecameAvailable: false,
      seatsFilled: false,
      instructorAssigned: false,
      newOpenSeats: 0,
    });
  });

  it('old Staff to new named instructor sets instructorAssigned', () => {
    const oldState = mockOldState({ instructor_name: 'Staff' });
    const result = detectChanges(
      oldState,
      mockClassDetails({ instructor_name: 'Dr. Smith', seats_available: 2, non_reserved_seats: 1 })
    );

    expect(result).toEqual({
      seatBecameAvailable: true,
      seatsFilled: false,
      instructorAssigned: true,
      newOpenSeats: 1,
    });
  });

  it('old named instructor to new named instructor does not set instructorAssigned', () => {
    const oldState = mockOldState({ instructor_name: 'Dr. Smith' });
    const result = detectChanges(oldState, mockClassDetails({ instructor_name: 'Prof. Johnson' }));

    expect(result.instructorAssigned).toBe(false);
  });

  it('both seat available and instructor assigned simultaneously', () => {
    const oldState = mockOldState({ non_reserved_seats: 0, instructor_name: 'Staff' });
    const result = detectChanges(
      oldState,
      mockClassDetails({ seats_available: 10, non_reserved_seats: 5, instructor_name: 'Dr. Smith' })
    );

    expect(result).toEqual({
      seatBecameAvailable: true,
      seatsFilled: false,
      instructorAssigned: true,
      newOpenSeats: 5,
    });
  });

  it('uses non_reserved_seats over seats_available when both present', () => {
    const oldState = mockOldState({ non_reserved_seats: 0 });
    const result = detectChanges(
      oldState,
      mockClassDetails({ seats_available: 10, non_reserved_seats: 3 })
    );

    expect(result.newOpenSeats).toBe(3);
  });

  it('falls back to seats_available when non_reserved_seats is null', () => {
    const oldState = mockOldState({ non_reserved_seats: null, seats_available: 0 });
    const result = detectChanges(
      oldState,
      mockClassDetails({ seats_available: 7, non_reserved_seats: null })
    );

    expect(result.newOpenSeats).toBe(7);
    expect(result.seatBecameAvailable).toBe(true);
  });

  it('handles undefined instructor in newData', () => {
    const oldState = mockOldState({ instructor_name: 'Staff' });
    const result = detectChanges(
      oldState,
      // eslint-disable-next-line anti-slop/no-chained-type-assertions
      mockClassDetails({ instructor_name: undefined as unknown as string })
    );

    expect(result.instructorAssigned).toBe(false);
  });
});
