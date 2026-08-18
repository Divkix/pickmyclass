import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import { AUTO_CLEANUP_MAX_EMAILS_PER_CYCLE } from '@/lib/config';

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
  incrementConsecutiveNotFound: vi.fn(),
  deleteSectionAndWatches: vi.fn(),
  getClassWatchers: vi.fn(),
  resetConsecutiveNotFound: vi.fn(),
}));

vi.mock('@/lib/queue/change-detector', () => ({
  detectChanges: vi.fn(),
}));

vi.mock('@/lib/queue/notification-sender', () => ({
  sendSectionNotifications: vi.fn(),
}));

vi.mock('@/lib/email/unsubscribe-token', () => ({
  generateUnsubscribeUrl: vi.fn(
    (userId: string) => `https://pickmyclass.app/unsubscribe?token=${userId}`
  ),
  generateUnsubscribeToken: vi.fn(() => 'mock-token'),
  verifyUnsubscribeToken: vi.fn(() => null),
}));

import {
  ApiError,
  AuthError,
  NotFoundError,
  RateLimitError,
  fetchClassFromASU,
} from '@/lib/asu/api';
import {
  deleteSectionAndWatches,
  getClassWatchers,
  incrementConsecutiveNotFound,
  resetNotificationsForSection,
} from '@/lib/db/queries';
import type { ChangeResult } from '@/lib/queue/change-detector';
import { detectChanges } from '@/lib/queue/change-detector';
import { sendSectionNotifications } from '@/lib/queue/notification-sender';
import { processSection } from '@/lib/queue/process-section';
import { getServiceClient } from '@/lib/supabase/service';
import type { ClassDetails } from '@/lib/types/class';
import type { Env, SendEmail } from '@/lib/types/env';

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

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
    // eslint-disable-next-line anti-slop/no-chained-type-assertions -- SAFETY: test double constructs minimal SendEmail shape for queue processing; only send is accessed
    EMAIL: { send: vi.fn().mockResolvedValue({ messageId: 'msg_test' }) } as unknown as SendEmail,
    NOTIFICATION_FROM_EMAIL: 'notifications@pickmyclass.app',
  };
}

/**
 * Build a mock DB client with chained methods that return `this` for fluent API.
 */
function buildMockDb(singleResolvedValue: {
  data: Record<string, JsonValue> | null;
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

/**
 * Helper to build a service client mock that handles breaker counts and classInfo fetch.
 * Supports the 3-strikes auto-cleanup breaker flow.
 */
function buildAutoCleanupServiceMock(
  opts: {
    total?: number;
    flagged?: number;
    oldStateData?: Record<string, JsonValue> | null;
    classInfoData?: {
      subject?: string | null;
      catalog_nbr?: string | null;
      title?: string | null;
    } | null;
  } = {}
) {
  const {
    total = 10,
    flagged = 1,
    oldStateData = {
      // SAFETY: test mock — controlled JsonValue fixture for class_states row — widening number to JsonValue for mock shape
      non_reserved_seats: 0 as JsonValue,
      // SAFETY: test mock — controlled JsonValue fixture for class_states row — widening number to JsonValue for mock shape
      seats_available: 0 as JsonValue,
      // SAFETY: test mock — controlled JsonValue fixture for class_states row — widening string to JsonValue for mock shape
      instructor_name: 'Staff' as JsonValue,
    },
    classInfoData = { subject: 'CSE', catalog_nbr: '110', title: 'Principles of Programming' },
  } = opts;

  let breakerCalls = 0;
  let lastSelectCols: string | null = null;
  let updatePayload: Record<string, unknown> | null = null;

  const mock: Record<string, unknown> & {
    from: ReturnType<typeof vi.fn>;
    select: ReturnType<typeof vi.fn>;
    eq: ReturnType<typeof vi.fn>;
    neq: ReturnType<typeof vi.fn>;
    single: ReturnType<typeof vi.fn>;
    upsert: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    // eslint-disable-next-line anti-slop/no-chained-type-assertions, anti-slop/require-safety-comment-for-type-assertion -- SAFETY: test mock — vi.fn() mocking Supabase client with controlled return values
  } = {
    // eslint-disable-next-line anti-slop/no-chained-type-assertions -- SAFETY: test mock — vi.fn() mocking Supabase client with controlled return values
    from: vi.fn().mockReturnThis() as unknown as ReturnType<typeof vi.fn>,
    // eslint-disable-next-line anti-slop/no-chained-type-assertions -- SAFETY: test mock — vi.fn() mocking Supabase client with controlled return values
    select: null as unknown as ReturnType<typeof vi.fn>,
    // eslint-disable-next-line anti-slop/no-chained-type-assertions -- SAFETY: test mock — vi.fn() mocking Supabase client with controlled return values
    eq: vi.fn().mockReturnThis() as unknown as ReturnType<typeof vi.fn>,
    // eslint-disable-next-line anti-slop/no-chained-type-assertions -- SAFETY: test mock — vi.fn() mocking Supabase client with controlled return values
    neq: vi.fn().mockReturnThis() as unknown as ReturnType<typeof vi.fn>,
    // eslint-disable-next-line anti-slop/no-chained-type-assertions -- SAFETY: test mock — vi.fn() mocking Supabase client with controlled return values
    single: null as unknown as ReturnType<typeof vi.fn>,
    // eslint-disable-next-line anti-slop/no-chained-type-assertions -- SAFETY: test mock — vi.fn() mocking Supabase client with controlled return values
    upsert: vi.fn().mockResolvedValue({ error: null }) as unknown as ReturnType<typeof vi.fn>,
    // eslint-disable-next-line anti-slop/no-chained-type-assertions -- SAFETY: test mock — vi.fn() mocking Supabase client with controlled return values
    update: null as unknown as ReturnType<typeof vi.fn>,
    // keep delete for completeness (not used directly in breaker path, helpers are mocked)
    // eslint-disable-next-line anti-slop/no-chained-type-assertions -- SAFETY: test mock — vi.fn() mocking Supabase client with controlled return values
    delete: vi.fn().mockReturnThis() as unknown as ReturnType<typeof vi.fn>,
    // eslint-disable-next-line anti-slop/no-chained-type-assertions, anti-slop/require-safety-comment-for-type-assertion -- SAFETY: test mock — vi.fn() mocking Supabase client with controlled return values
  } as unknown as typeof mock & { delete: ReturnType<typeof vi.fn> };

  // eslint-disable-next-line anti-slop/no-chained-type-assertions -- SAFETY: test mock — vi.fn() mocking Supabase client with controlled return values
  mock.select = vi.fn((cols: string, sOpts?: { count?: string; head?: boolean }) => {
    if (sOpts?.count === 'exact' && sOpts?.head === true) {
      breakerCalls++;
      if (breakerCalls === 1) {
        return Promise.resolve({ count: total, error: null });
      }
      return {
        gte: vi.fn().mockResolvedValue({ count: flagged, error: null }),
      };
    }
    lastSelectCols = cols;
    return mock;
  }) as unknown as ReturnType<typeof vi.fn>;

  // eslint-disable-next-line anti-slop/no-chained-type-assertions -- SAFETY: test mock — vi.fn() mocking Supabase client with controlled return values
  mock.single = vi.fn(() => {
    if (lastSelectCols?.includes('subject, catalog_nbr, title')) {
      return Promise.resolve({ data: classInfoData, error: null });
    }
    return Promise.resolve({ data: oldStateData, error: null });
  }) as unknown as ReturnType<typeof vi.fn>;

  // eslint-disable-next-line anti-slop/no-chained-type-assertions -- SAFETY: test mock — vi.fn() mocking Supabase client with controlled return values
  mock.update = vi.fn((payload: Record<string, unknown>) => {
    updatePayload = payload;
    return mock;
  }) as unknown as ReturnType<typeof vi.fn>;

  // Thenable for cap update: `await applySectionRef(client.from('class_states').update(...), ref)` awaits the builder
  // eslint-disable-next-line anti-slop/no-chained-type-assertions -- SAFETY: test mock — thenable mock for Supabase builder with controlled then shape
  (mock as unknown as { then: unknown }).then = (
    // eslint-disable-next-line anti-slop/no-unknown-parameters, anti-slop/no-unknown-returns -- SAFETY: test helper — validates mock shape, input is controlled test data
    onFulfilled: (v: unknown) => unknown,
    // eslint-disable-next-line anti-slop/no-unknown-parameters, anti-slop/no-unknown-returns -- SAFETY: test helper — validates mock shape, input is controlled test data
    onRejected: (e: unknown) => unknown
  ) => {
    if (updatePayload) {
      return Promise.resolve({ error: null }).then(
        // eslint-disable-next-line anti-slop/no-unknown-parameters, anti-slop/no-unknown-returns -- SAFETY: test helper — validates mock shape, input is controlled test data
        onFulfilled as (v: unknown) => unknown,
        // eslint-disable-next-line anti-slop/no-unknown-parameters, anti-slop/no-unknown-returns -- SAFETY: test helper — validates mock shape, input is controlled test data
        onRejected as (e: unknown) => unknown
      );
    }
    return Promise.resolve({ error: null, data: null }).then(
      // eslint-disable-next-line anti-slop/no-unknown-parameters, anti-slop/no-unknown-returns -- SAFETY: test helper — validates mock shape, input is controlled test data
      onFulfilled as (v: unknown) => unknown,
      // eslint-disable-next-line anti-slop/no-unknown-parameters, anti-slop/no-unknown-returns -- SAFETY: test helper — validates mock shape, input is controlled test data
      onRejected as (e: unknown) => unknown
    );
  };

  // expose helpers for assertions
  // eslint-disable-next-line anti-slop/no-chained-type-assertions, anti-slop/no-unknown-returns -- SAFETY: test helper — validates mock shape, input is controlled test data
  (mock as unknown as { _getUpdatePayload: () => unknown })._getUpdatePayload = () => updatePayload;
  // eslint-disable-next-line anti-slop/no-chained-type-assertions -- SAFETY: test mock — vi.fn() mocking Supabase client with controlled return values
  (mock as unknown as { _getBreakerCalls: () => number })._getBreakerCalls = () => breakerCalls;

  // eslint-disable-next-line anti-slop/no-chained-type-assertions -- SAFETY: test mock — vi.fn() mocking Supabase client with controlled return values
  return mock as unknown as ReturnType<typeof buildMockDb> & {
    _getUpdatePayload: () => Record<string, unknown> | null;
    _getBreakerCalls: () => number;
  };
}

describe('processSection', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});

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
    // SAFETY: test double constructs minimal shape for the SDK contract; only accessed fields are asserted
    (getServiceClient as ReturnType<typeof vi.fn>).mockReturnValue(mockDb);

    // SAFETY: test double constructs minimal shape for the SDK contract; only accessed fields are asserted
    (fetchClassFromASU as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockClassDetails({ seats_available: 5, non_reserved_seats: 3, instructor_name: 'Dr. Smith' })
    );

    // SAFETY: test double constructs minimal shape for the SDK contract; only accessed fields are asserted
    (detectChanges as ReturnType<typeof vi.fn>).mockReturnValue(
      buildChangeResult({ seatBecameAvailable: true, newOpenSeats: 3 })
    );

    // SAFETY: test double constructs minimal shape for the SDK contract; only accessed fields are asserted
    (sendSectionNotifications as ReturnType<typeof vi.fn>).mockResolvedValue([
      { success: true, watchId: 'w1', type: 'seat_available' },
    ]);

    // SAFETY: test double constructs minimal shape for the SDK contract; only accessed fields are asserted
    (resetNotificationsForSection as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    // Default auto-cleanup mocks: no deletion unless test overrides
    (incrementConsecutiveNotFound as ReturnType<typeof vi.fn>).mockResolvedValue(1);
    (deleteSectionAndWatches as ReturnType<typeof vi.fn>).mockResolvedValue({
      watchesDeleted: 0,
      stateDeleted: true,
    });
    (getClassWatchers as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('successful full flow: fetches, detects, notifies, and persists', async () => {
    const env = buildEnv();
    const outcome = await processSection({ class_nbr: '42737', term: '2261' }, env);

    // Should have fetched old state with correct chaining (includes term)
    // eslint-disable-next-line anti-slop/no-chained-type-assertions -- SAFETY: test double needs unknown intermediate because SupabaseClient not overlapping mock type
    const db = getServiceClient() as unknown as ReturnType<typeof buildMockDb>;
    expect(db.from).toHaveBeenCalledWith('class_states');
    expect(db.select).toHaveBeenCalledWith(
      'class_nbr, term, seats_available, non_reserved_seats, instructor_name, consecutive_not_found_count'
    );
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
    // SAFETY: test double constructs minimal shape for the SDK contract; only accessed fields are asserted
    (detectChanges as ReturnType<typeof vi.fn>).mockReturnValue(buildChangeResult());

    const outcome = await processSection({ class_nbr: '42737', term: '2261' }, buildEnv());

    expect(sendSectionNotifications).not.toHaveBeenCalled();
    expect(resetNotificationsForSection).not.toHaveBeenCalled();
    expect(outcome.disposition).toBe('ack');
    expect(outcome.result.success).toBe(true);
    expect(outcome.result.emailsSent).toBe(0);
  });

  it('seats filled: resets notifications and persists', async () => {
    // SAFETY: test double constructs minimal shape for the SDK contract; only accessed fields are asserted
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
    // SAFETY: test double constructs minimal shape for the SDK contract; only accessed fields are asserted
    (fetchClassFromASU as ReturnType<typeof vi.fn>).mockRejectedValue(
      new NotFoundError('Section 42737 not found')
    );
    // auto-cleanup increment defaults to 1 in beforeEach, so no deletion
    const outcome = await processSection({ class_nbr: '42737', term: '2261' }, buildEnv());

    expect(outcome.disposition).toBe('ack');
    expect(outcome.httpStatus).toBe(200);
    expect(outcome.retryable).toBe(false);
    expect(outcome.result.success).toBe(false);
    expect(outcome.result.error).toBe('Section 42737 not found');
    // Should NOT have tried to persist or notify
    // eslint-disable-next-line anti-slop/no-chained-type-assertions -- SAFETY: test double needs unknown intermediate because SupabaseClient not overlapping mock type
    const db = getServiceClient() as unknown as ReturnType<typeof buildMockDb>;
    expect(db.upsert).not.toHaveBeenCalled();
    expect(sendSectionNotifications).not.toHaveBeenCalled();
  });

  it('ASU API throws RateLimitError: returns retry outcome (429)', async () => {
    // SAFETY: test double constructs minimal shape for the SDK contract; only accessed fields are asserted
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
    // SAFETY: test double constructs minimal shape for the SDK contract; only accessed fields are asserted
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
    // SAFETY: test double constructs minimal shape for the SDK contract; only accessed fields are asserted
    (getServiceClient as ReturnType<typeof vi.fn>).mockReturnValue(mockDb);

    // SAFETY: test double constructs minimal shape for the SDK contract; only accessed fields are asserted
    (fetchClassFromASU as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockClassDetails({ seats_available: 5, non_reserved_seats: 3 })
    );

    // detectChanges would report a seat became available, but with no baseline (oldState null)
    // this is a false positive that must be suppressed.
    // SAFETY: test double constructs minimal shape for the SDK contract; only accessed fields are asserted
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
    // SAFETY: test double constructs minimal shape for the SDK contract; only accessed fields are asserted
    (getServiceClient as ReturnType<typeof vi.fn>).mockReturnValue(mockDb);

    const outcome = await processSection({ class_nbr: '42737', term: '2261' }, buildEnv());

    expect(detectChanges).not.toHaveBeenCalled();
    expect(fetchClassFromASU).not.toHaveBeenCalled();
    expect(sendSectionNotifications).not.toHaveBeenCalled();
    // eslint-disable-next-line anti-slop/no-chained-type-assertions -- SAFETY: test double needs unknown intermediate because SupabaseClient not overlapping mock type
    const db = getServiceClient() as unknown as ReturnType<typeof buildMockDb>;
    expect(db.upsert).not.toHaveBeenCalled();
    expect(outcome.disposition).toBe('retry');
    expect(outcome.httpStatus).toBe(500);
    expect(outcome.retryable).toBe(true);
    expect(outcome.result.success).toBe(false);
    expect(outcome.result.error).toEqual(expect.stringContaining('Connection timeout'));
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
      // SAFETY: test double constructs minimal shape for the SDK contract; only accessed fields are asserted
      (getServiceClient as ReturnType<typeof vi.fn>).mockReturnValue(mockDb);

      // SAFETY: test double constructs minimal shape for the SDK contract; only accessed fields are asserted
      (fetchClassFromASU as ReturnType<typeof vi.fn>).mockResolvedValue(
        mockClassDetails({ seats_available: 5, non_reserved_seats: 5 })
      );
      // SAFETY: test double constructs minimal shape for the SDK contract; only accessed fields are asserted
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
      // SAFETY: test double constructs minimal shape for the SDK contract; only accessed fields are asserted
      (getServiceClient as ReturnType<typeof vi.fn>).mockReturnValue(mockDb);

      const outcome = await processSection({ class_nbr: '12345', term: '2261' }, buildEnv());
      expect(outcome.disposition).toBe('retry');
      expect(outcome.httpStatus).toBe(500);
      expect(outcome.retryable).toBe(true);
    });

    it('acks a thrown AuthError (non-retryable: bad token)', async () => {
      // SAFETY: test double constructs minimal shape for the SDK contract; only accessed fields are asserted
      (fetchClassFromASU as ReturnType<typeof vi.fn>).mockRejectedValue(
        new AuthError('401 Unauthorized from ASU')
      );
      const outcome = await processSection({ class_nbr: '12345', term: '2261' }, buildEnv());
      expect(outcome.disposition).toBe('ack');
      expect(outcome.httpStatus).toBe(200);
      expect(outcome.retryable).toBe(false);
    });

    it('acks a thrown NotFoundError (non-retryable: section gone)', async () => {
      // SAFETY: test double constructs minimal shape for the SDK contract; only accessed fields are asserted
      (fetchClassFromASU as ReturnType<typeof vi.fn>).mockRejectedValue(
        new NotFoundError('Section 99999 not found')
      );
      const outcome = await processSection({ class_nbr: '12345', term: '2261' }, buildEnv());
      expect(outcome.disposition).toBe('ack');
      expect(outcome.httpStatus).toBe(200);
      expect(outcome.retryable).toBe(false);
    });

    it('retries a thrown RateLimitError (transient upstream)', async () => {
      // SAFETY: test double constructs minimal shape for the SDK contract; only accessed fields are asserted
      (fetchClassFromASU as ReturnType<typeof vi.fn>).mockRejectedValue(
        new RateLimitError('Rate limit exceeded')
      );
      const outcome = await processSection({ class_nbr: '12345', term: '2261' }, buildEnv());
      expect(outcome.disposition).toBe('retry');
      expect(outcome.httpStatus).toBe(429);
      expect(outcome.retryable).toBe(true);
    });

    it('retries a thrown ApiError (upstream failure)', async () => {
      // SAFETY: test double constructs minimal shape for the SDK contract; only accessed fields are asserted
      (fetchClassFromASU as ReturnType<typeof vi.fn>).mockRejectedValue(
        new ApiError('ASU API 502 Bad Gateway', 502)
      );
      const outcome = await processSection({ class_nbr: '12345', term: '2261' }, buildEnv());
      expect(outcome.disposition).toBe('retry');
      expect(outcome.httpStatus).toBe(502);
      expect(outcome.retryable).toBe(true);
    });

    it('retries an unknown thrown Error (defensive)', async () => {
      // SAFETY: test double constructs minimal shape for the SDK contract; only accessed fields are asserted
      (fetchClassFromASU as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Unexpected internal error')
      );
      const outcome = await processSection({ class_nbr: '12345', term: '2261' }, buildEnv());
      expect(outcome.disposition).toBe('retry');
      expect(outcome.httpStatus).toBe(500);
      expect(outcome.retryable).toBe(true);
    });

    it('retries an unknown thrown non-Error value (defensive)', async () => {
      // eslint-disable-next-line anti-slop/no-chained-type-assertions -- SAFETY: test verifies defensive handling of non-Error throw values; needs unknown intermediate because string not overlapping Error
      (fetchClassFromASU as ReturnType<typeof vi.fn>).mockRejectedValue('boom' as unknown as Error);
      const outcome = await processSection({ class_nbr: '12345', term: '2261' }, buildEnv());
      expect(outcome.disposition).toBe('retry');
      expect(outcome.httpStatus).toBe(500);
      expect(outcome.retryable).toBe(true);

      // SAFETY: test double mocks service client; vi.fn shape matches expected contract
      (fetchClassFromASU as ReturnType<typeof vi.fn>).mockRejectedValue(
        // eslint-disable-next-line anti-slop/no-chained-type-assertions -- SAFETY: test verifies defensive handling of non-Error throw values; needs unknown intermediate because undefined not overlapping Error
        undefined as unknown as Error
      );
      const outcome2 = await processSection({ class_nbr: '12345', term: '2261' }, buildEnv());
      expect(outcome2.disposition).toBe('retry');

      // eslint-disable-next-line anti-slop/no-chained-type-assertions -- SAFETY: test verifies defensive handling of non-Error throw values; needs unknown intermediate because null not overlapping Error
      (fetchClassFromASU as ReturnType<typeof vi.fn>).mockRejectedValue(null as unknown as Error);
      const outcome3 = await processSection({ class_nbr: '12345', term: '2261' }, buildEnv());
      expect(outcome3.disposition).toBe('retry');
    });

    it('AuthError is acked even though it extends ApiError (subclass ordering)', async () => {
      // Ensures AuthError/NotFound check wins before ApiError base
      // SAFETY: test double constructs minimal shape for the SDK contract; only accessed fields are asserted
      (fetchClassFromASU as ReturnType<typeof vi.fn>).mockRejectedValue(new AuthError('401'));
      const outcome = await processSection({ class_nbr: '12345', term: '2261' }, buildEnv());
      expect(outcome.disposition).toBe('ack');
      expect(outcome.httpStatus).toBe(200);
    });
  });

  describe('auto-cleanup: 3-strikes NotFound handling', () => {
    it('first NotFound -> increments count to 1, ack, no deletion, no retry', async () => {
      const mockDb = buildMockDb({
        data: { non_reserved_seats: 0, seats_available: 0, instructor_name: 'Staff' },
        error: null,
      });
      (getServiceClient as ReturnType<typeof vi.fn>).mockReturnValue(mockDb);
      (fetchClassFromASU as ReturnType<typeof vi.fn>).mockRejectedValue(
        new NotFoundError('Section 42737 not found')
      );
      (incrementConsecutiveNotFound as ReturnType<typeof vi.fn>).mockResolvedValue(1);

      const env = buildEnv();
      const outcome = await processSection({ class_nbr: '42737', term: '2261' }, env);

      expect(incrementConsecutiveNotFound).toHaveBeenCalledWith({
        class_nbr: '42737',
        term: '2261',
      });
      expect(incrementConsecutiveNotFound).toHaveBeenCalledTimes(1);
      expect(deleteSectionAndWatches).not.toHaveBeenCalled();
      expect(getClassWatchers).not.toHaveBeenCalled();
      expect(env.EMAIL.send).not.toHaveBeenCalled();
      expect(mockDb.upsert).not.toHaveBeenCalled();
      expect(outcome.disposition).toBe('ack');
      expect(outcome.httpStatus).toBe(200);
      expect(outcome.retryable).toBe(false);
      expect(outcome.result.success).toBe(false);
      expect(outcome.result.error).toBe('Section 42737 not found');
      expect(outcome.result.emailsSent).toBe(0);
    });

    it('second consecutive NotFound -> count 2, ack, no deletion', async () => {
      const mockDb = buildMockDb({
        data: { non_reserved_seats: 0, seats_available: 0, instructor_name: 'Staff' },
        error: null,
      });
      (getServiceClient as ReturnType<typeof vi.fn>).mockReturnValue(mockDb);
      (fetchClassFromASU as ReturnType<typeof vi.fn>).mockRejectedValue(
        new NotFoundError('Section 42737 not found')
      );
      (incrementConsecutiveNotFound as ReturnType<typeof vi.fn>).mockResolvedValue(2);

      const env = buildEnv();
      const outcome = await processSection({ class_nbr: '42737', term: '2261' }, env);

      expect(incrementConsecutiveNotFound).toHaveBeenCalledWith({
        class_nbr: '42737',
        term: '2261',
      });
      expect(deleteSectionAndWatches).not.toHaveBeenCalled();
      expect(env.EMAIL.send).not.toHaveBeenCalled();
      expect(outcome.disposition).toBe('ack');
      expect(outcome.httpStatus).toBe(200);
      expect(outcome.result.success).toBe(false);
      expect(outcome.result.error).toBe('Section 42737 not found');
    });

    it('third consecutive NotFound with watchers -> deletes SectionRef-scoped watches and state, notifies watchers, ack with Auto-cleanup error', async () => {
      const serviceMock = buildAutoCleanupServiceMock({
        total: 10,
        flagged: 1, // ratio 0.1 < 0.2, breaker NOT tripped
        oldStateData: { non_reserved_seats: 0, seats_available: 0, instructor_name: 'Staff' },
        classInfoData: { subject: 'CSE', catalog_nbr: '110', title: 'Principles of Programming' },
      });
      (getServiceClient as ReturnType<typeof vi.fn>).mockReturnValue(serviceMock);
      (fetchClassFromASU as ReturnType<typeof vi.fn>).mockRejectedValue(
        new NotFoundError('Section 42737 not found')
      );
      (incrementConsecutiveNotFound as ReturnType<typeof vi.fn>).mockResolvedValue(3);
      (getClassWatchers as ReturnType<typeof vi.fn>).mockResolvedValue([
        { user_id: 'u1', email: 'alice@example.com', watch_id: 'w1' },
        { user_id: 'u2', email: 'bob@example.com', watch_id: 'w2' },
      ]);
      (deleteSectionAndWatches as ReturnType<typeof vi.fn>).mockResolvedValue({
        watchesDeleted: 2,
        stateDeleted: true,
      });

      const env = buildEnv();
      const outcome = await processSection({ class_nbr: '42737', term: '2261' }, env);

      expect(incrementConsecutiveNotFound).toHaveBeenCalledWith({
        class_nbr: '42737',
        term: '2261',
      });
      // Verify deletion is SectionRef-scoped (both class_nbr and term)
      expect(deleteSectionAndWatches).toHaveBeenCalledWith({ class_nbr: '42737', term: '2261' });
      expect(deleteSectionAndWatches).toHaveBeenCalledTimes(1);
      expect(getClassWatchers).toHaveBeenCalledWith({ class_nbr: '42737', term: '2261' });

      // Verify EMAIL.send called for each watcher with correct subject/link
      expect(env.EMAIL.send).toHaveBeenCalledTimes(2);
      const firstSend = (env.EMAIL.send as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
        to: string;
        subject: string;
        html: string;
        text: string;
      };
      expect(firstSend.to).toBe('alice@example.com');
      expect(firstSend.subject).toContain('removed');
      expect(firstSend.subject.toLowerCase()).toContain('no longer in asu catalog');
      expect(firstSend.html).toContain('/dashboard');
      expect(firstSend.html).toContain('pickmyclass.app');
      const secondSend = (env.EMAIL.send as ReturnType<typeof vi.fn>).mock.calls[1][0] as {
        to: string;
      };
      expect(secondSend.to).toBe('bob@example.com');

      expect(outcome.disposition).toBe('ack');
      expect(outcome.httpStatus).toBe(200);
      expect(outcome.result.success).toBe(true);
      expect(outcome.result.error).toContain('Auto-cleanup');
      expect(outcome.result.emailsSent).toBe(2);
      expect(outcome.result.classNbr).toBe('42737');
    });

    it('third consecutive NotFound with zero watchers -> still deletes state with no email', async () => {
      const serviceMock = buildAutoCleanupServiceMock({
        total: 20,
        flagged: 2, // ratio 0.1 < 0.2
        oldStateData: { non_reserved_seats: 0, seats_available: 0, instructor_name: 'Staff' },
        classInfoData: { subject: 'CSE', catalog_nbr: '240', title: 'Intro' },
      });
      (getServiceClient as ReturnType<typeof vi.fn>).mockReturnValue(serviceMock);
      (fetchClassFromASU as ReturnType<typeof vi.fn>).mockRejectedValue(
        new NotFoundError('Section 99999 not found')
      );
      (incrementConsecutiveNotFound as ReturnType<typeof vi.fn>).mockResolvedValue(3);
      (getClassWatchers as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      (deleteSectionAndWatches as ReturnType<typeof vi.fn>).mockResolvedValue({
        watchesDeleted: 0,
        stateDeleted: true,
      });

      const env = buildEnv();
      const outcome = await processSection({ class_nbr: '99999', term: '2261' }, env);

      expect(incrementConsecutiveNotFound).toHaveBeenCalledWith({
        class_nbr: '99999',
        term: '2261',
      });
      expect(deleteSectionAndWatches).toHaveBeenCalledWith({ class_nbr: '99999', term: '2261' });
      expect(env.EMAIL.send).not.toHaveBeenCalled();
      expect(outcome.disposition).toBe('ack');
      expect(outcome.result.error).toContain('Auto-cleanup');
      expect(outcome.result.emailsSent).toBe(0);
      expect(outcome.result.success).toBe(true);
    });

    it('success after NotFounds -> resets count to 0 via upsert payload', async () => {
      const mockDb = buildMockDb({
        data: { non_reserved_seats: 0, seats_available: 0, instructor_name: 'Staff' },
        error: null,
      });
      (getServiceClient as ReturnType<typeof vi.fn>).mockReturnValue(mockDb);
      (fetchClassFromASU as ReturnType<typeof vi.fn>).mockResolvedValue(
        mockClassDetails({ seats_available: 5, non_reserved_seats: 3 })
      );
      (detectChanges as ReturnType<typeof vi.fn>).mockReturnValue(buildChangeResult());

      const env = buildEnv();
      const outcome = await processSection({ class_nbr: '42737', term: '2261' }, env);

      expect(mockDb.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          class_nbr: '42737',
          term: '2261',
          consecutive_not_found_count: 0,
        }),
        { onConflict: 'class_nbr,term' }
      );
      expect(incrementConsecutiveNotFound).not.toHaveBeenCalled();
      expect(deleteSectionAndWatches).not.toHaveBeenCalled();
      expect(outcome.disposition).toBe('ack');
      expect(outcome.result.success).toBe(true);
    });

    it('RateLimitError (429) does NOT increment NotFound count and returns retry', async () => {
      (fetchClassFromASU as ReturnType<typeof vi.fn>).mockRejectedValue(
        new RateLimitError('Rate limit hit')
      );

      const outcome = await processSection({ class_nbr: '42737', term: '2261' }, buildEnv());

      expect(incrementConsecutiveNotFound).not.toHaveBeenCalled();
      expect(deleteSectionAndWatches).not.toHaveBeenCalled();
      expect(getClassWatchers).not.toHaveBeenCalled();
      expect(outcome.disposition).toBe('retry');
      expect(outcome.httpStatus).toBe(429);
      expect(outcome.retryable).toBe(true);
      expect(outcome.result.error).toBe('Rate limit hit');
    });

    it('ApiError 502 does NOT increment NotFound count and returns retry', async () => {
      (fetchClassFromASU as ReturnType<typeof vi.fn>).mockRejectedValue(
        new ApiError('ASU API 502 Bad Gateway', 502)
      );

      const outcome = await processSection({ class_nbr: '42737', term: '2261' }, buildEnv());

      expect(incrementConsecutiveNotFound).not.toHaveBeenCalled();
      expect(deleteSectionAndWatches).not.toHaveBeenCalled();
      expect(outcome.disposition).toBe('retry');
      expect(outcome.httpStatus).toBe(502);
      expect(outcome.retryable).toBe(true);
      expect(outcome.result.error).toBe('ASU API 502 Bad Gateway');
    });

    it('timeout ApiError (408) does NOT increment NotFound count and returns retry', async () => {
      (fetchClassFromASU as ReturnType<typeof vi.fn>).mockRejectedValue(
        new ApiError('ASU API request timed out', 408)
      );

      const outcome = await processSection({ class_nbr: '42737', term: '2261' }, buildEnv());

      expect(incrementConsecutiveNotFound).not.toHaveBeenCalled();
      expect(deleteSectionAndWatches).not.toHaveBeenCalled();
      expect(outcome.disposition).toBe('retry');
      // processSection maps ApiError to 502 per retryOutcome signature
      expect(outcome.httpStatus).toBe(502);
      expect(outcome.retryable).toBe(true);
      expect(outcome.result.error).toBe('ASU API request timed out');
    });

    it('AuthError still ack without increment (existing behavior)', async () => {
      (fetchClassFromASU as ReturnType<typeof vi.fn>).mockRejectedValue(
        new AuthError('401 Unauthorized from ASU')
      );

      const outcome = await processSection({ class_nbr: '12345', term: '2261' }, buildEnv());

      expect(incrementConsecutiveNotFound).not.toHaveBeenCalled();
      expect(deleteSectionAndWatches).not.toHaveBeenCalled();
      expect(outcome.disposition).toBe('ack');
      expect(outcome.httpStatus).toBe(200);
      expect(outcome.retryable).toBe(false);
      expect(outcome.result.success).toBe(false);
      expect(outcome.result.error).toBe('401 Unauthorized from ASU');
    });

    it('term scoping: increment for 76337/2261 does NOT affect 76337/2257', async () => {
      // First term 2261
      const mockDb1 = buildMockDb({
        data: { non_reserved_seats: 0, seats_available: 0, instructor_name: 'Staff' },
        error: null,
      });
      (getServiceClient as ReturnType<typeof vi.fn>).mockReturnValue(mockDb1);
      (fetchClassFromASU as ReturnType<typeof vi.fn>).mockRejectedValue(
        new NotFoundError('Section 76337 not found')
      );
      (incrementConsecutiveNotFound as ReturnType<typeof vi.fn>).mockResolvedValue(1);

      const env = buildEnv();
      await processSection({ class_nbr: '76337', term: '2261' }, env);

      expect(incrementConsecutiveNotFound).toHaveBeenCalledWith({
        class_nbr: '76337',
        term: '2261',
      });
      expect(incrementConsecutiveNotFound).not.toHaveBeenCalledWith({
        class_nbr: '76337',
        term: '2257',
      });
      expect(mockDb1.eq).toHaveBeenCalledWith('term', '2261');
      expect(mockDb1.eq).toHaveBeenCalledWith('class_nbr', '76337');

      vi.clearAllMocks();
      // Re-setup mocks after clear (clearAllMocks resets implementations to no-op, so re-mock)
      const mockDb2 = buildMockDb({
        data: { non_reserved_seats: 0, seats_available: 0, instructor_name: 'Staff' },
        error: null,
      });
      (getServiceClient as ReturnType<typeof vi.fn>).mockReturnValue(mockDb2);
      (fetchClassFromASU as ReturnType<typeof vi.fn>).mockRejectedValue(
        new NotFoundError('Section 76337 not found')
      );
      (incrementConsecutiveNotFound as ReturnType<typeof vi.fn>).mockResolvedValue(1);
      (deleteSectionAndWatches as ReturnType<typeof vi.fn>).mockResolvedValue({
        watchesDeleted: 0,
        stateDeleted: true,
      });
      (getClassWatchers as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      await processSection({ class_nbr: '76337', term: '2257' }, env);

      expect(incrementConsecutiveNotFound).toHaveBeenCalledWith({
        class_nbr: '76337',
        term: '2257',
      });
      expect(mockDb2.eq).toHaveBeenCalledWith('term', '2257');
      expect(mockDb2.eq).toHaveBeenCalledWith('class_nbr', '76337');
      // Ensure second call used different term
      expect(incrementConsecutiveNotFound).not.toHaveBeenCalledWith({
        class_nbr: '76337',
        term: '2261',
      });
    });

    it('circuit breaker: ratio >0.2 suppresses deletion, caps count at 2, logs suppressed, ack without deletion', async () => {
      const serviceMock = buildAutoCleanupServiceMock({
        total: 10,
        flagged: 5, // ratio 0.5 > 0.2 → tripped
        oldStateData: { non_reserved_seats: 0, seats_available: 0, instructor_name: 'Staff' },
        classInfoData: null,
      });
      (getServiceClient as ReturnType<typeof vi.fn>).mockReturnValue(serviceMock);
      (fetchClassFromASU as ReturnType<typeof vi.fn>).mockRejectedValue(
        new NotFoundError('Section 42737 not found')
      );
      (incrementConsecutiveNotFound as ReturnType<typeof vi.fn>).mockResolvedValue(3);
      (getClassWatchers as ReturnType<typeof vi.fn>).mockResolvedValue([
        { user_id: 'u1', email: 'alice@example.com', watch_id: 'w1' },
      ]);
      (deleteSectionAndWatches as ReturnType<typeof vi.fn>).mockResolvedValue({
        watchesDeleted: 1,
        stateDeleted: true,
      });

      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      vi.spyOn(console, 'error').mockImplementation(() => {});
      // also need warn for log('ProcessSection').warn which routes through console.warn — already spied
      const env = buildEnv();
      const outcome = await processSection({ class_nbr: '42737', term: '2261' }, env);

      // Even though count would be 3, deletion suppressed
      expect(deleteSectionAndWatches).not.toHaveBeenCalled();
      expect(getClassWatchers).not.toHaveBeenCalled();
      expect(env.EMAIL.send).not.toHaveBeenCalled();

      // Count capped at 2 via update with neq guard to avoid no-op WAL writes
      // eslint-disable-next-line no-restricted-syntax -- SAFETY: test mock narrowing requires ReturnType wrapper — vi.fn() mock
      expect(
        // eslint-disable-next-line anti-slop/no-chained-type-assertions -- SAFETY: test mock — vi.fn() mocking Supabase client with controlled return values — narrowing requires ReturnType wrapper
        (serviceMock as unknown as { update: ReturnType<typeof vi.fn> }).update
      ).toHaveBeenCalledWith({ consecutive_not_found_count: 2 });
      // eslint-disable-next-line no-restricted-syntax -- SAFETY: test mock narrowing requires ReturnType wrapper — vi.fn() mock
      expect(
        // eslint-disable-next-line anti-slop/no-chained-type-assertions -- SAFETY: test mock — vi.fn() mocking Supabase client with controlled return values — narrowing requires ReturnType wrapper
        (serviceMock as unknown as { neq: ReturnType<typeof vi.fn> }).neq
      ).toHaveBeenCalledWith('consecutive_not_found_count', 2);
      expect(serviceMock.eq).toHaveBeenCalledWith('class_nbr', '42737');
      expect(serviceMock.eq).toHaveBeenCalledWith('term', '2261');
      // Logs 'Auto-cleanup suppressed'
      const warnCalls = consoleWarnSpy.mock.calls.map(
        (c) => String(c[0]) + ' ' + String(c[1] ?? '')
      );
      const suppressedLogged = warnCalls.some((s) => s.includes('Auto-cleanup suppressed'));
      expect(suppressedLogged).toBe(true);

      expect(outcome.disposition).toBe('ack');
      expect(outcome.httpStatus).toBe(200);
      expect(outcome.retryable).toBe(false);
      expect(outcome.result.success).toBe(false);
      expect(outcome.result.emailsSent).toBe(0);
      // Suppressed path returns original NotFound error, not Auto-cleanup
      expect(outcome.result.error).toBe('Section 42737 not found');

      // rely on afterEach restoreAllMocks
    });

    it('breaker ratio exactly 0.2 does NOT suppress (threshold is >0.2)', async () => {
      // total 10 flagged 2 => 0.2 exactly, should NOT suppress
      const serviceMock = buildAutoCleanupServiceMock({
        total: 10,
        flagged: 2,
        oldStateData: { non_reserved_seats: 0, seats_available: 0, instructor_name: 'Staff' },
        classInfoData: { subject: 'CSE', catalog_nbr: '110', title: 'T' },
      });
      (getServiceClient as ReturnType<typeof vi.fn>).mockReturnValue(serviceMock);
      (fetchClassFromASU as ReturnType<typeof vi.fn>).mockRejectedValue(
        new NotFoundError('Section 42737 not found')
      );
      (incrementConsecutiveNotFound as ReturnType<typeof vi.fn>).mockResolvedValue(3);
      (getClassWatchers as ReturnType<typeof vi.fn>).mockResolvedValue([
        { user_id: 'u1', email: 'a@example.com', watch_id: 'w1' },
      ]);
      (deleteSectionAndWatches as ReturnType<typeof vi.fn>).mockResolvedValue({
        watchesDeleted: 1,
        stateDeleted: true,
      });

      const env = buildEnv();
      const outcome = await processSection({ class_nbr: '42737', term: '2261' }, env);

      expect(deleteSectionAndWatches).toHaveBeenCalled();
      expect(outcome.result.error).toContain('Auto-cleanup');
      expect(outcome.result.emailsSent).toBe(1);
    });

    it('increment failure: ack without deletion, no throw', async () => {
      const mockDb = buildMockDb({
        data: { non_reserved_seats: 0, seats_available: 0, instructor_name: 'Staff' },
        error: null,
      });
      (getServiceClient as ReturnType<typeof vi.fn>).mockReturnValue(mockDb);
      (fetchClassFromASU as ReturnType<typeof vi.fn>).mockRejectedValue(
        new NotFoundError('Section 42737 not found')
      );
      (incrementConsecutiveNotFound as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('DB down')
      );

      const outcome = await processSection({ class_nbr: '42737', term: '2261' }, buildEnv());

      expect(outcome.disposition).toBe('ack');
      expect(outcome.httpStatus).toBe(200);
      expect(outcome.result.success).toBe(false);
      expect(deleteSectionAndWatches).not.toHaveBeenCalled();
    });

    it('caps watchers at AUTO_CLEANUP_MAX_EMAILS_PER_CYCLE and truncates emails, logs warn', async () => {
      const cap = AUTO_CLEANUP_MAX_EMAILS_PER_CYCLE;
      const overCap = cap + 100;
      const manyWatchers = Array.from({ length: overCap }, (_, i) => ({
        user_id: `u${i}`,
        email: `user${i}@example.com`,
        watch_id: `w${i}`,
      }));
      const serviceMock = buildAutoCleanupServiceMock({
        total: 1000,
        flagged: 10, // ratio 0.01 < 0.2, breaker NOT tripped
        oldStateData: { non_reserved_seats: 0, seats_available: 0, instructor_name: 'Staff' },
        classInfoData: { subject: 'CSE', catalog_nbr: '110', title: 'Principles of Programming' },
      });
      (getServiceClient as ReturnType<typeof vi.fn>).mockReturnValue(serviceMock);
      (fetchClassFromASU as ReturnType<typeof vi.fn>).mockRejectedValue(
        new NotFoundError('Section 42737 not found')
      );
      (incrementConsecutiveNotFound as ReturnType<typeof vi.fn>).mockResolvedValue(3);
      (getClassWatchers as ReturnType<typeof vi.fn>).mockResolvedValue(manyWatchers);
      (deleteSectionAndWatches as ReturnType<typeof vi.fn>).mockResolvedValue({
        watchesDeleted: overCap,
        stateDeleted: true,
      });

      vi.spyOn(console, 'warn').mockImplementation(() => {});
      // Speed up batch delay for 500 sends — mock setTimeout to immediate
      vi.spyOn(globalThis, 'setTimeout')
        // eslint-disable-next-line anti-slop/no-unknown-parameters -- SAFETY: test mock — setTimeout overload narrowed to callback+delay used by auto-cleanup batch throttle
        .mockImplementation((cb: () => void) => {
          cb();
          // eslint-disable-next-line anti-slop/no-chained-type-assertions -- SAFETY: test double returns Timeout shape for batch throttle; only used for immediate resolve in cap truncation test
          return {} as unknown as ReturnType<typeof setTimeout>;
        });

      const env = buildEnv();
      const outcome = await processSection({ class_nbr: '42737', term: '2261' }, env);

      expect(deleteSectionAndWatches).toHaveBeenCalledWith({ class_nbr: '42737', term: '2261' });
      // Real sendAutoCleanupRemovalEmails called via processSection — should be truncated to cap
      expect(env.EMAIL.send).toHaveBeenCalledTimes(cap);
      expect(outcome.result.emailsSent).toBe(cap);
      // watchesDeleted vs emailsSent inequality when over cap: all watches deleted but only cap emailed
      expect(overCap).toBeGreaterThan(cap);
      // watchesDeleted === originalLength (overCap) — delete mock returned overCap
      expect(overCap).toBe(manyWatchers.length);
      expect(overCap).toBeGreaterThan(outcome.result.emailsSent);
      expect(outcome.result.success).toBe(true);
      expect(outcome.result.error).toContain('Auto-cleanup');
      // threshold assertion includes threshold value (3)
      expect(outcome.result.error).toContain('3');
      // eslint-disable-next-line anti-slop/no-chained-type-assertions -- SAFETY: console.warn mock narrowing requires ReturnType wrapper
      const warnCalls = (console.warn as unknown as ReturnType<typeof vi.fn>).mock.calls.map(
        (c) => String(c[0]) + ' ' + String(c[1] ?? '')
      );
      expect(warnCalls.some((s) => s.includes('exceeds cap') && s.includes('truncating'))).toBe(
        true
      );
    });
    it('breaker check logs total flagged ratio before suppression decision', async () => {
      const serviceMock = buildAutoCleanupServiceMock({
        total: 100,
        flagged: 5, // ratio 0.05 < 0.2, NOT suppressed — should still log info
        oldStateData: { non_reserved_seats: 0, seats_available: 0, instructor_name: 'Staff' },
        classInfoData: { subject: 'CSE', catalog_nbr: '110', title: 'T' },
      });
      (getServiceClient as ReturnType<typeof vi.fn>).mockReturnValue(serviceMock);
      (fetchClassFromASU as ReturnType<typeof vi.fn>).mockRejectedValue(
        new NotFoundError('Section 42737 not found')
      );
      (incrementConsecutiveNotFound as ReturnType<typeof vi.fn>).mockResolvedValue(3);
      (getClassWatchers as ReturnType<typeof vi.fn>).mockResolvedValue([
        { user_id: 'u1', email: 'a@example.com', watch_id: 'w1' },
      ]);
      (deleteSectionAndWatches as ReturnType<typeof vi.fn>).mockResolvedValue({
        watchesDeleted: 1,
        stateDeleted: true,
      });

      const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
      const env = buildEnv();
      await processSection({ class_nbr: '42737', term: '2261' }, env);

      const infoCalls = infoSpy.mock.calls.map((c) => String(c[0]) + ' ' + String(c[1] ?? ''));
      expect(
        infoCalls.some((s) => s.includes('Breaker check total=100 flagged=5 ratio=0.050'))
      ).toBe(true);

      // rely on afterEach restoreAllMocks
    });

    it('breaker tripped also logs ratio info and warn suppressed', async () => {
      const serviceMock = buildAutoCleanupServiceMock({
        total: 100,
        flagged: 30, // ratio 0.30 > 0.2, suppressed
        oldStateData: { non_reserved_seats: 0, seats_available: 0, instructor_name: 'Staff' },
        classInfoData: null,
      });
      (getServiceClient as ReturnType<typeof vi.fn>).mockReturnValue(serviceMock);
      (fetchClassFromASU as ReturnType<typeof vi.fn>).mockRejectedValue(
        new NotFoundError('Section 42737 not found')
      );
      (incrementConsecutiveNotFound as ReturnType<typeof vi.fn>).mockResolvedValue(3);

      const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const env = buildEnv();
      const outcome = await processSection({ class_nbr: '42737', term: '2261' }, env);

      const infoCalls = infoSpy.mock.calls.map((c) => String(c[0]) + ' ' + String(c[1] ?? ''));
      expect(
        infoCalls.some((s) => s.includes('Breaker check total=100 flagged=30 ratio=0.300'))
      ).toBe(true);
      const warnCalls = warnSpy.mock.calls.map((c) => String(c[0]) + ' ' + String(c[1] ?? ''));
      expect(warnCalls.some((s) => s.includes('Auto-cleanup suppressed'))).toBe(true);
      expect(deleteSectionAndWatches).not.toHaveBeenCalled();
      expect(outcome.result.success).toBe(false);

      // rely on afterEach restoreAllMocks
    });
  });
});
