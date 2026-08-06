import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';

// Mock all dependencies
vi.mock('@/lib/supabase/service', () => ({
  getServiceClient: vi.fn(),
}));

vi.mock('@/lib/asu/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/asu/api')>()),
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

import {
  ApiError,
  AuthError,
  NotFoundError,
  RateLimitError,
  fetchClassFromASU,
} from '@/lib/asu/api';
import { resetNotificationsForSection } from '@/lib/db/queries';
import type { ChangeResult } from '@/lib/queue/change-detector';
import { detectChanges } from '@/lib/queue/change-detector';
import { sendSectionNotifications } from '@/lib/queue/notification-sender';
import { processSection } from '@/lib/queue/process-section';
import { getServiceClient } from '@/lib/supabase/service';
import type { ClassDetails } from '@/lib/types/class';
import type { Env, SendEmail } from '@/lib/types/env';

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
      mockClassDetails({ seats_available: 5, non_reserved_seats: 3, instructor_name: 'Dr. Smith' })
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
    const outcome = await processSection({ class_nbr: '42737', term: '2261' }, env);

    // Should have fetched old state with correct chaining (includes term)
    const db = getServiceClient() as unknown as ReturnType<typeof buildMockDb>;
    expect(db.from).toHaveBeenCalledWith('class_states');
    expect(db.select).toHaveBeenCalledWith('*');
    expect(db.eq).toHaveBeenCalledWith('class_nbr', '42737');
    expect(db.eq).toHaveBeenCalledWith('term', '2261');
    expect(db.single).toHaveBeenCalled();

    // Should have fetched from ASU with the SectionRef
    expect(fetchClassFromASU).toHaveBeenCalledWith({ class_nbr: '42737', term: '2261' }, env);

    // Should have detected changes
    expect(detectChanges).toHaveBeenCalled();

    // Should have sent notifications, carrying the full SectionRef (class_nbr + term)
    // so recipient selection is term-scoped (issue #303).
    expect(sendSectionNotifications).toHaveBeenCalledWith(
      expect.objectContaining({
        ref: { class_nbr: '42737', term: '2261' },
        classInfo: expect.objectContaining({ class_nbr: '42737', term: '2261' }),
      })
    );

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
      { onConflict: 'class_nbr,term' }
    );

    expect(outcome.disposition).toBe('ack');
    expect(outcome.httpStatus).toBe(200);
    expect(outcome.retryable).toBe(false);
    expect(outcome.result).toMatchObject({
      success: true,
      classNbr: '42737',
      changes: expect.objectContaining({ seatBecameAvailable: true }),
      emailsSent: 1,
      processingTimeMs: expect.any(Number),
    });
  });

  it('no changes detected: only persists, no notifications', async () => {
    (detectChanges as ReturnType<typeof vi.fn>).mockReturnValue(buildChangeResult());

    const outcome = await processSection({ class_nbr: '42737', term: '2261' }, buildEnv());

    expect(sendSectionNotifications).not.toHaveBeenCalled();
    expect(resetNotificationsForSection).not.toHaveBeenCalled();
    expect(outcome.disposition).toBe('ack');
    expect(outcome.result.success).toBe(true);
    expect(outcome.result.emailsSent).toBe(0);
  });

  it('seats filled: resets notifications and persists', async () => {
    (detectChanges as ReturnType<typeof vi.fn>).mockReturnValue(
      buildChangeResult({ seatsFilled: true, newOpenSeats: 0 })
    );

    const outcome = await processSection({ class_nbr: '42737', term: '2261' }, buildEnv());

    expect(resetNotificationsForSection).toHaveBeenCalledWith(
      { class_nbr: '42737', term: '2261' },
      'seat_available'
    );
    expect(sendSectionNotifications).not.toHaveBeenCalled();
    expect(outcome.result.success).toBe(true);
    expect(outcome.disposition).toBe('ack');
  });

  it('ASU API throws NotFoundError: returns ack outcome (non-retryable)', async () => {
    (fetchClassFromASU as ReturnType<typeof vi.fn>).mockRejectedValue(
      new NotFoundError('Section 42737 not found')
    );

    const outcome = await processSection({ class_nbr: '42737', term: '2261' }, buildEnv());

    expect(outcome.disposition).toBe('ack');
    expect(outcome.httpStatus).toBe(200);
    expect(outcome.retryable).toBe(false);
    expect(outcome.result.success).toBe(false);
    expect(outcome.result.error).toBe('Section 42737 not found');
    // Should NOT have tried to persist or notify
    const db = getServiceClient() as unknown as ReturnType<typeof buildMockDb>;
    expect(db.upsert).not.toHaveBeenCalled();
    expect(sendSectionNotifications).not.toHaveBeenCalled();
  });

  it('ASU API throws RateLimitError: returns retry outcome (429)', async () => {
    (fetchClassFromASU as ReturnType<typeof vi.fn>).mockRejectedValue(
      new RateLimitError('Rate limit hit')
    );

    const outcome = await processSection({ class_nbr: '42737', term: '2261' }, buildEnv());

    expect(outcome.disposition).toBe('retry');
    expect(outcome.httpStatus).toBe(429);
    expect(outcome.retryable).toBe(true);
    expect(outcome.result.error).toBe('Rate limit hit');
  });

  it('DB upsert fails: returns retry outcome (500)', async () => {
    const mockDb = buildMockDb({
      data: { non_reserved_seats: 0, seats_available: 0, instructor_name: 'Staff' },
      error: null,
    });
    mockDb.upsert.mockResolvedValue({ error: { message: 'Constraint violation' } });
    (getServiceClient as ReturnType<typeof vi.fn>).mockReturnValue(mockDb);

    const outcome = await processSection({ class_nbr: '42737', term: '2261' }, buildEnv());

    expect(outcome.disposition).toBe('retry');
    expect(outcome.httpStatus).toBe(500);
    expect(outcome.retryable).toBe(true);
    expect(outcome.result).toMatchObject({
      success: false,
      error: expect.stringContaining('Constraint violation'),
    });
  });

  it('first observation with open seats: suppresses notification, only persists baseline', async () => {
    // First observation = PGRST116 error (no rows found)
    const mockDb = buildMockDb({
      data: null,
      error: { code: 'PGRST116', message: 'No rows found' },
    });
    (getServiceClient as ReturnType<typeof vi.fn>).mockReturnValue(mockDb);

    (fetchClassFromASU as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockClassDetails({ seats_available: 5, non_reserved_seats: 3 })
    );

    // detectChanges would report a seat became available, but with no baseline (oldState null)
    // this is a false positive that must be suppressed.
    (detectChanges as ReturnType<typeof vi.fn>).mockReturnValue(
      buildChangeResult({ seatBecameAvailable: true, newOpenSeats: 3 })
    );

    const outcome = await processSection({ class_nbr: '42737', term: '2261' }, buildEnv());

    // detectChanges should have been called with null oldState (PGRST116 returns data: null)
    expect(detectChanges).toHaveBeenCalledWith(
      null,
      expect.objectContaining({ seats_available: 5 })
    );

    // First-observation suppression: NO emails sent.
    expect(sendSectionNotifications).not.toHaveBeenCalled();
    // Baseline still persisted.
    expect(mockDb.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ class_nbr: '42737', term: '2261', seats_available: 5 }),
      { onConflict: 'class_nbr,term' }
    );
    expect(outcome.result.success).toBe(true);
    expect(outcome.disposition).toBe('ack');
    expect(outcome.result.changes.seatBecameAvailable).toBe(false);
    expect(outcome.result.emailsSent).toBe(0);
  });

  it('handles non-PGRST116 DB error gracefully and continues processing', async () => {
    const mockDb = buildMockDb({
      data: null,
      error: { code: 'OTHER_ERR', message: 'Connection timeout' },
    });
    (getServiceClient as ReturnType<typeof vi.fn>).mockReturnValue(mockDb);

    const outcome = await processSection({ class_nbr: '42737', term: '2261' }, buildEnv());

    // non-PGRST116 errors log but don't stop processing
    expect(console.error).toHaveBeenCalledWith(
      '[ProcessSection]',
      'Error fetching old state for 42737:',
      expect.any(Object)
    );
    // Should continue with null old state
    expect(detectChanges).toHaveBeenCalledWith(null, expect.any(Object));
    expect(outcome.result.success).toBe(true);
    expect(outcome.disposition).toBe('ack');
  });

  describe('send/persist ordering', () => {
    it('does NOT send notifications when the state upsert fails (persist before send)', async () => {
      // oldState: no open seats. ASU: open seats available → seat became available.
      const mockDb = buildMockDb({
        data: { non_reserved_seats: 0, seats_available: 0, instructor_name: 'Staff' },
        error: null,
      });
      // The class_states upsert (Step 5, now before send) fails.
      mockDb.upsert.mockResolvedValue({ error: { message: 'upsert exploded' } });
      (getServiceClient as ReturnType<typeof vi.fn>).mockReturnValue(mockDb);

      (fetchClassFromASU as ReturnType<typeof vi.fn>).mockResolvedValue(
        mockClassDetails({ seats_available: 5, non_reserved_seats: 5 })
      );
      (detectChanges as ReturnType<typeof vi.fn>).mockReturnValue(
        buildChangeResult({ seatBecameAvailable: true, newOpenSeats: 5 })
      );

      const outcome = await processSection({ class_nbr: '42737', term: '2261' }, buildEnv());

      // Persist-before-send: a failed upsert must short-circuit BEFORE any emails go out,
      // so a retry re-attempts cleanly with no duplicate emails.
      expect(sendSectionNotifications).not.toHaveBeenCalled();
      // The upsert failure still surfaces as an unsuccessful result.
      expect(outcome).toMatchObject({
        disposition: 'retry',
        result: expect.objectContaining({
          success: false,
          error: expect.stringContaining('upsert exploded'),
        }),
      });
    });
  });

  // Merged disposition cases — previously in disposition.test.ts
  describe('disposition via processSection', () => {
    it('acks a successful outcome', async () => {
      // default mocks already produce success
      const outcome = await processSection({ class_nbr: '12345', term: '2261' }, buildEnv());
      expect(outcome.disposition).toBe('ack');
      expect(outcome.httpStatus).toBe(200);
      expect(outcome.retryable).toBe(false);
    });

    it('retries a failed outcome (DB upsert error)', async () => {
      const mockDb = buildMockDb({
        data: { non_reserved_seats: 0, seats_available: 0, instructor_name: 'Staff' },
        error: null,
      });
      mockDb.upsert.mockResolvedValue({ error: { message: 'upsert fail' } });
      (getServiceClient as ReturnType<typeof vi.fn>).mockReturnValue(mockDb);

      const outcome = await processSection({ class_nbr: '12345', term: '2261' }, buildEnv());
      expect(outcome.disposition).toBe('retry');
      expect(outcome.httpStatus).toBe(500);
      expect(outcome.retryable).toBe(true);
    });

    it('acks a thrown AuthError (non-retryable: bad token)', async () => {
      (fetchClassFromASU as ReturnType<typeof vi.fn>).mockRejectedValue(
        new AuthError('401 Unauthorized from ASU')
      );
      const outcome = await processSection({ class_nbr: '12345', term: '2261' }, buildEnv());
      expect(outcome.disposition).toBe('ack');
      expect(outcome.httpStatus).toBe(200);
      expect(outcome.retryable).toBe(false);
    });

    it('acks a thrown NotFoundError (non-retryable: section gone)', async () => {
      (fetchClassFromASU as ReturnType<typeof vi.fn>).mockRejectedValue(
        new NotFoundError('Section 99999 not found')
      );
      const outcome = await processSection({ class_nbr: '12345', term: '2261' }, buildEnv());
      expect(outcome.disposition).toBe('ack');
      expect(outcome.httpStatus).toBe(200);
      expect(outcome.retryable).toBe(false);
    });

    it('retries a thrown RateLimitError (transient upstream)', async () => {
      (fetchClassFromASU as ReturnType<typeof vi.fn>).mockRejectedValue(
        new RateLimitError('Rate limit exceeded')
      );
      const outcome = await processSection({ class_nbr: '12345', term: '2261' }, buildEnv());
      expect(outcome.disposition).toBe('retry');
      expect(outcome.httpStatus).toBe(429);
      expect(outcome.retryable).toBe(true);
    });

    it('retries a thrown ApiError (upstream failure)', async () => {
      (fetchClassFromASU as ReturnType<typeof vi.fn>).mockRejectedValue(
        new ApiError('ASU API 502 Bad Gateway', 502)
      );
      const outcome = await processSection({ class_nbr: '12345', term: '2261' }, buildEnv());
      expect(outcome.disposition).toBe('retry');
      expect(outcome.httpStatus).toBe(502);
      expect(outcome.retryable).toBe(true);
    });

    it('retries an unknown thrown Error (defensive)', async () => {
      (fetchClassFromASU as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Unexpected internal error')
      );
      const outcome = await processSection({ class_nbr: '12345', term: '2261' }, buildEnv());
      expect(outcome.disposition).toBe('retry');
      expect(outcome.httpStatus).toBe(500);
      expect(outcome.retryable).toBe(true);
    });

    it('retries an unknown thrown non-Error value (defensive)', async () => {
      (fetchClassFromASU as ReturnType<typeof vi.fn>).mockRejectedValue('boom' as unknown as Error);
      const outcome = await processSection({ class_nbr: '12345', term: '2261' }, buildEnv());
      expect(outcome.disposition).toBe('retry');
      expect(outcome.httpStatus).toBe(500);
      expect(outcome.retryable).toBe(true);

      (fetchClassFromASU as ReturnType<typeof vi.fn>).mockRejectedValue(
        undefined as unknown as Error
      );
      const outcome2 = await processSection({ class_nbr: '12345', term: '2261' }, buildEnv());
      expect(outcome2.disposition).toBe('retry');

      (fetchClassFromASU as ReturnType<typeof vi.fn>).mockRejectedValue(null as unknown as Error);
      const outcome3 = await processSection({ class_nbr: '12345', term: '2261' }, buildEnv());
      expect(outcome3.disposition).toBe('retry');
    });

    it('AuthError is acked even though it extends ApiError (subclass ordering)', async () => {
      // Ensures AuthError/NotFound check wins before ApiError base
      (fetchClassFromASU as ReturnType<typeof vi.fn>).mockRejectedValue(new AuthError('401'));
      const outcome = await processSection({ class_nbr: '12345', term: '2261' }, buildEnv());
      expect(outcome.disposition).toBe('ack');
      expect(outcome.httpStatus).toBe(200);
    });
  });
});
