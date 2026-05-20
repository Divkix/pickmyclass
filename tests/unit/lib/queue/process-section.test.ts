import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock all dependencies
vi.mock('@/lib/supabase/service', () => ({
  getServiceClient: vi.fn(),
}));

vi.mock('@/lib/asu/api', () => ({
  fetchClassFromASU: vi.fn(),
}));

vi.mock('@/lib/db/queries', () => ({
  resetNotificationsForSection: vi.fn(),
}));

vi.mock('@/lib/queue/change-detector', () => ({
  detectChanges: vi.fn(),
}));

vi.mock('@/lib/queue/notification-sender', () => ({
  sendSectionNotifications: vi.fn(),
}));

import { fetchClassFromASU } from '@/lib/asu/api';
import { resetNotificationsForSection } from '@/lib/db/queries';
import type { ChangeResult } from '@/lib/queue/change-detector';
import { detectChanges } from '@/lib/queue/change-detector';
import { sendSectionNotifications } from '@/lib/queue/notification-sender';
import { processSection } from '@/lib/queue/process-section';
import { getServiceClient } from '@/lib/supabase/service';
import type { ClassDetails } from '@/lib/types/class';
import type { Env } from '@/lib/types/env';

function mockClassDetails(overrides: Partial<ClassDetails> = {}): ClassDetails {
  return {
    subject: 'CSE',
    catalog_nbr: '110',
    title: 'Principles of Programming',
    instructor: 'Staff',
    seats_available: 0,
    seats_capacity: 100,
    non_reserved_seats: null,
    location: 'TBD',
    meeting_times: 'TBD',
    ...overrides,
  };
}

function buildChangeResult(overrides: Partial<ChangeResult> = {}): ChangeResult {
  return {
    seatBecameAvailable: false,
    seatsFilled: false,
    instructorAssigned: false,
    newOpenSeats: 0,
    ...overrides,
  };
}

function buildEnv(): Pick<
  Env,
  'ASU_API_BASE_URL' | 'ASU_API_TOKEN' | 'EMAIL' | 'NOTIFICATION_FROM_EMAIL'
> {
  return {
    ASU_API_BASE_URL: 'https://api.example.com',
    ASU_API_TOKEN: 'test-token',
    EMAIL: { send: vi.fn() } as unknown as SendEmail,
    NOTIFICATION_FROM_EMAIL: 'notifications@pickmyclass.app',
  };
}

/**
 * Build a mock DB client with chained methods that return `this` for fluent API.
 */
function buildMockDb(singleResolvedValue: {
  data: Record<string, unknown> | null;
  error: { code?: string; message: string } | null;
}) {
  const singleFn = vi.fn().mockResolvedValue(singleResolvedValue);
  const mockDb = {
    from: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: singleFn,
    upsert: vi.fn().mockResolvedValue({ error: null }),
  };
  return mockDb;
}

describe('processSection', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});

    // Reset all mocks to clear call history from previous tests,
    // then re-apply default implementations
    vi.resetAllMocks();

    // Default mock: existing state found in DB
    const mockDb = buildMockDb({
      data: {
        non_reserved_seats: 0,
        seats_available: 0,
        instructor_name: 'Staff',
      },
      error: null,
    });
    (getServiceClient as ReturnType<typeof vi.fn>).mockReturnValue(mockDb);

    (fetchClassFromASU as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockClassDetails({ seats_available: 5, non_reserved_seats: 3, instructor: 'Dr. Smith' })
    );

    (detectChanges as ReturnType<typeof vi.fn>).mockReturnValue(
      buildChangeResult({ seatBecameAvailable: true, newOpenSeats: 3 })
    );

    (sendSectionNotifications as ReturnType<typeof vi.fn>).mockResolvedValue([
      { success: true, watchId: 'w1', type: 'seat_available' },
    ]);

    (resetNotificationsForSection as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('successful full flow: fetches, detects, notifies, and persists', async () => {
    const env = buildEnv();
    const result = await processSection('42737', '2261', env);

    // Should have fetched old state with correct chaining
    const db = getServiceClient() as unknown as ReturnType<typeof buildMockDb>;
    expect(db.from).toHaveBeenCalledWith('class_states');
    expect(db.select).toHaveBeenCalledWith('*');
    expect(db.eq).toHaveBeenCalledWith('class_nbr', '42737');
    expect(db.single).toHaveBeenCalled();

    // Should have fetched from ASU
    expect(fetchClassFromASU).toHaveBeenCalledWith('42737', '2261', env);

    // Should have detected changes
    expect(detectChanges).toHaveBeenCalled();

    // Should have sent notifications
    expect(sendSectionNotifications).toHaveBeenCalled();

    // Should have upserted new state (with onConflict option)
    expect(db.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        class_nbr: '42737',
        term: '2261',
        subject: 'CSE',
        seats_available: 5,
        non_reserved_seats: 3,
        last_checked_at: expect.any(String),
      }),
      { onConflict: 'class_nbr' }
    );

    expect(result).toMatchObject({
      success: true,
      classNbr: '42737',
      changes: expect.objectContaining({ seatBecameAvailable: true }),
      emailsSent: 1,
      processingTimeMs: expect.any(Number),
    });
  });

  it('no changes detected: only persists, no notifications', async () => {
    (detectChanges as ReturnType<typeof vi.fn>).mockReturnValue(buildChangeResult());

    const result = await processSection('42737', '2261', buildEnv());

    expect(sendSectionNotifications).not.toHaveBeenCalled();
    expect(resetNotificationsForSection).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
    expect(result.emailsSent).toBe(0);
  });

  it('seats filled: resets notifications and persists', async () => {
    (detectChanges as ReturnType<typeof vi.fn>).mockReturnValue(
      buildChangeResult({ seatsFilled: true, newOpenSeats: 0 })
    );

    const result = await processSection('42737', '2261', buildEnv());

    expect(resetNotificationsForSection).toHaveBeenCalledWith('42737', 'seat_available');
    expect(sendSectionNotifications).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
  });

  it('ASU API throws NotFoundError: returns non-retryable error', async () => {
    const notFoundError = new Error('Section 42737 not found');
    notFoundError.name = 'NotFoundError';
    (fetchClassFromASU as ReturnType<typeof vi.fn>).mockRejectedValue(notFoundError);

    const result = await processSection('42737', '2261', buildEnv());

    expect(result).toMatchObject({
      success: false,
      error: expect.stringContaining('not found'),
    });
    // Should NOT have tried to persist or notify
    const db = getServiceClient() as unknown as ReturnType<typeof buildMockDb>;
    expect(db.upsert).not.toHaveBeenCalled();
    expect(sendSectionNotifications).not.toHaveBeenCalled();
  });

  it('ASU API throws RateLimitError: returns error result (caught by try/catch)', async () => {
    const rateLimitError = new Error('Rate limit hit');
    rateLimitError.name = 'RateLimitError';
    (fetchClassFromASU as ReturnType<typeof vi.fn>).mockRejectedValue(rateLimitError);

    const result = await processSection('42737', '2261', buildEnv());

    // The catch block catches all errors and returns a ProcessingResult
    expect(result).toMatchObject({
      success: false,
      error: expect.stringContaining('Rate limit'),
    });
  });

  it('DB upsert fails: returns error result', async () => {
    const mockDb = buildMockDb({
      data: { non_reserved_seats: 0, seats_available: 0, instructor_name: 'Staff' },
      error: null,
    });
    mockDb.upsert.mockResolvedValue({ error: { message: 'Constraint violation' } });
    (getServiceClient as ReturnType<typeof vi.fn>).mockReturnValue(mockDb);

    const result = await processSection('42737', '2261', buildEnv());

    expect(result).toMatchObject({
      success: false,
      error: expect.stringContaining('Constraint violation'),
    });
  });

  it('first observation with open seats: sends seat available notification', async () => {
    // First observation = PGRST116 error (no rows found)
    const mockDb = buildMockDb({
      data: null,
      error: { code: 'PGRST116', message: 'No rows found' },
    });
    (getServiceClient as ReturnType<typeof vi.fn>).mockReturnValue(mockDb);

    (fetchClassFromASU as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockClassDetails({ seats_available: 5, non_reserved_seats: 3 })
    );

    (detectChanges as ReturnType<typeof vi.fn>).mockReturnValue(
      buildChangeResult({ seatBecameAvailable: true, newOpenSeats: 3 })
    );

    const result = await processSection('42737', '2261', buildEnv());

    // detectChanges should have been called with null oldState (PGRST116 returns data: null)
    expect(detectChanges).toHaveBeenCalledWith(
      null,
      expect.objectContaining({ seats_available: 5 })
    );

    // Should have sent notifications
    expect(sendSectionNotifications).toHaveBeenCalled();
    expect(result.success).toBe(true);
    expect(result.changes.seatBecameAvailable).toBe(true);
    expect(result.emailsSent).toBe(1);
  });

  it('handles non-PGRST116 DB error gracefully and continues processing', async () => {
    const mockDb = buildMockDb({
      data: null,
      error: { code: 'OTHER_ERR', message: 'Connection timeout' },
    });
    (getServiceClient as ReturnType<typeof vi.fn>).mockReturnValue(mockDb);

    const result = await processSection('42737', '2261', buildEnv());

    // non-PGRST116 errors log but don't stop processing
    expect(console.error).toHaveBeenCalledWith(
      '[ProcessSection] Error fetching old state for 42737:',
      expect.any(Object)
    );
    // Should continue with null old state
    expect(detectChanges).toHaveBeenCalledWith(null, expect.any(Object));
    expect(result.success).toBe(true);
  });
});
