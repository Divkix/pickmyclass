import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import { AUTO_CLEANUP_MAX_EMAILS_PER_CYCLE } from '@/lib/config';

vi.mock('@/lib/asu/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/asu/api')>()),
  fetchClassFromASU: vi.fn(),
}));

vi.mock('@/lib/db/queries', () => ({
  resetNotificationsForSection: vi.fn(),
  incrementConsecutiveNotFound: vi.fn(),
  deleteSectionAndWatches: vi.fn(),
  getClassWatchers: vi.fn(),
  upsertClassState: vi.fn(),
  readSectionCheckState: vi.fn(),
  readAutoCleanupBreakerCounts: vi.fn(),
  capConsecutiveNotFound: vi.fn(),
  readSectionRemovalClassInfo: vi.fn(),
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
import type { Database } from '@/lib/db';
import {
  capConsecutiveNotFound,
  deleteSectionAndWatches,
  getClassWatchers,
  incrementConsecutiveNotFound,
  readAutoCleanupBreakerCounts,
  readSectionCheckState,
  readSectionRemovalClassInfo,
  resetNotificationsForSection,
  upsertClassState,
} from '@/lib/db/queries';
import type { SectionCheckState, SectionRemovalClassInfo } from '@/lib/db/queries';
import type { ChangeResult } from '@/lib/queue/change-detector';
import { detectChanges } from '@/lib/queue/change-detector';
import { sendSectionNotifications } from '@/lib/queue/notification-sender';
import { processSection } from '@/lib/queue/process-section';
import type { ClassDetails } from '@/lib/types/class';
import type { Env, SendEmail } from '@/lib/types/env';

const db = {} as Database;

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
    // eslint-disable-next-line anti-slop/no-chained-type-assertions
    EMAIL: { send: vi.fn().mockResolvedValue({ messageId: 'msg_test' }) } as unknown as SendEmail,
    NOTIFICATION_FROM_EMAIL: 'notifications@pickmyclass.app',
  };
}

function defaultOldStateRow(overrides: Partial<SectionCheckState> = {}): SectionCheckState {
  return {
    class_nbr: '42737',
    term: '2261',
    seats_available: 0,
    non_reserved_seats: 0,
    instructor_name: 'Staff',
    consecutive_not_found_count: 0,
    ...overrides,
  };
}

function setupOldStateMock(row: SectionCheckState | null): void {
  vi.mocked(readSectionCheckState).mockResolvedValue(row);
}

function setupAutoCleanupMocks(
  opts: {
    total?: number;
    flagged?: number;
    oldStateRow?: SectionCheckState | null;
    classInfo?: SectionRemovalClassInfo | null;
  } = {}
): void {
  const {
    total = 10,
    flagged = 1,
    oldStateRow = defaultOldStateRow(),
    classInfo = { subject: 'CSE', catalog_nbr: '110', title: 'Principles of Programming' },
  } = opts;

  setupOldStateMock(oldStateRow);
  vi.mocked(readAutoCleanupBreakerCounts).mockResolvedValue({ total, flagged });
  vi.mocked(readSectionRemovalClassInfo).mockResolvedValue(classInfo);
}

describe('processSection', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});

    vi.resetAllMocks();

    setupOldStateMock(defaultOldStateRow());

    vi.mocked(upsertClassState).mockResolvedValue(undefined);

    vi.mocked(fetchClassFromASU).mockResolvedValue(
      mockClassDetails({ seats_available: 5, non_reserved_seats: 3, instructor_name: 'Dr. Smith' })
    );

    vi.mocked(detectChanges).mockReturnValue(
      buildChangeResult({ seatBecameAvailable: true, newOpenSeats: 3 })
    );

    vi.mocked(sendSectionNotifications).mockResolvedValue([
      { success: true, watchId: 'w1', type: 'seat_available' },
    ]);

    vi.mocked(resetNotificationsForSection).mockResolvedValue(undefined);
    vi.mocked(incrementConsecutiveNotFound).mockResolvedValue(1);
    vi.mocked(deleteSectionAndWatches).mockResolvedValue({
      watchesDeleted: 0,
      stateDeleted: true,
    });
    vi.mocked(getClassWatchers).mockResolvedValue([]);
    vi.mocked(readAutoCleanupBreakerCounts).mockResolvedValue({ total: 10, flagged: 1 });
    vi.mocked(capConsecutiveNotFound).mockResolvedValue(undefined);
    vi.mocked(readSectionRemovalClassInfo).mockResolvedValue(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('successful full flow: fetches, detects, notifies, and persists', async () => {
    const env = buildEnv();
    const outcome = await processSection(db, { class_nbr: '42737', term: '2261' }, env);

    expect(readSectionCheckState).toHaveBeenCalledWith(db, { class_nbr: '42737', term: '2261' });
    expect(fetchClassFromASU).toHaveBeenCalledWith({ class_nbr: '42737', term: '2261' }, env);

    expect(detectChanges).toHaveBeenCalled();

    expect(sendSectionNotifications).toHaveBeenCalledWith(
      expect.objectContaining({
        ref: { class_nbr: '42737', term: '2261' },
        classInfo: expect.objectContaining({ class_nbr: '42737', term: '2261' }),
      })
    );

    expect(upsertClassState).toHaveBeenCalledWith(
      db,
      { class_nbr: '42737', term: '2261' },
      expect.objectContaining({
        subject: 'CSE',
        seats_available: 5,
        non_reserved_seats: 3,
      })
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
    expect(outcome.result.retirement).toBeUndefined();
  });

  it('no changes detected: only persists, no notifications', async () => {
    vi.mocked(detectChanges).mockReturnValue(buildChangeResult());

    const outcome = await processSection(db, { class_nbr: '42737', term: '2261' }, buildEnv());

    expect(sendSectionNotifications).not.toHaveBeenCalled();
    expect(resetNotificationsForSection).not.toHaveBeenCalled();
    expect(outcome.disposition).toBe('ack');
    expect(outcome.result.success).toBe(true);
    expect(outcome.result.emailsSent).toBe(0);
  });

  it('seats filled: resets notifications and persists', async () => {
    vi.mocked(detectChanges).mockReturnValue(
      buildChangeResult({ seatsFilled: true, newOpenSeats: 0 })
    );

    const outcome = await processSection(db, { class_nbr: '42737', term: '2261' }, buildEnv());

    expect(resetNotificationsForSection).toHaveBeenCalledWith(
      db,
      { class_nbr: '42737', term: '2261' },
      'seat_available'
    );
    expect(sendSectionNotifications).not.toHaveBeenCalled();
    expect(outcome.result.success).toBe(true);
    expect(outcome.disposition).toBe('ack');
  });

  it('ASU API throws NotFoundError: returns ack outcome (non-retryable)', async () => {
    vi.mocked(fetchClassFromASU).mockRejectedValue(new NotFoundError('Section 42737 not found'));
    const outcome = await processSection(db, { class_nbr: '42737', term: '2261' }, buildEnv());

    expect(outcome.disposition).toBe('ack');
    expect(outcome.httpStatus).toBe(200);
    expect(outcome.retryable).toBe(false);
    expect(outcome.result.success).toBe(false);
    expect(outcome.result.error).toBe('Section 42737 not found');
    expect(upsertClassState).not.toHaveBeenCalled();
    expect(sendSectionNotifications).not.toHaveBeenCalled();
    expect(outcome.result.retirement).toMatchObject({
      status: 'tracked',
      strikeCount: 1,
      suppressed: false,
      deleted: false,
      watchesDeleted: 0,
      emailsAttempted: 0,
      emailsSucceeded: 0,
    });
  });

  it('ASU API throws RateLimitError: returns retry outcome (429)', async () => {
    vi.mocked(fetchClassFromASU).mockRejectedValue(new RateLimitError('Rate limit hit'));

    const outcome = await processSection(db, { class_nbr: '42737', term: '2261' }, buildEnv());

    expect(outcome.disposition).toBe('retry');
    expect(outcome.httpStatus).toBe(429);
    expect(outcome.retryable).toBe(true);
    expect(outcome.result.error).toBe('Rate limit hit');
  });

  it('DB upsert fails: returns retry outcome (500)', async () => {
    vi.mocked(upsertClassState).mockRejectedValue(new Error('Constraint violation'));

    const outcome = await processSection(db, { class_nbr: '42737', term: '2261' }, buildEnv());

    expect(outcome.disposition).toBe('retry');
    expect(outcome.httpStatus).toBe(500);
    expect(outcome.retryable).toBe(true);
    expect(outcome.result).toMatchObject({
      success: false,
      error: expect.stringContaining('Constraint violation'),
    });
  });

  it('first observation with open seats: suppresses notification, only persists baseline', async () => {
    setupOldStateMock(null);

    vi.mocked(fetchClassFromASU).mockResolvedValue(
      mockClassDetails({ seats_available: 5, non_reserved_seats: 3 })
    );

    vi.mocked(detectChanges).mockReturnValue(
      buildChangeResult({ seatBecameAvailable: true, newOpenSeats: 3 })
    );

    const outcome = await processSection(db, { class_nbr: '42737', term: '2261' }, buildEnv());

    expect(detectChanges).toHaveBeenCalledWith(
      null,
      expect.objectContaining({ seats_available: 5 })
    );

    expect(sendSectionNotifications).not.toHaveBeenCalled();
    expect(upsertClassState).toHaveBeenCalledWith(
      db,
      { class_nbr: '42737', term: '2261' },
      expect.objectContaining({ seats_available: 5 })
    );
    expect(outcome.result.success).toBe(true);
    expect(outcome.disposition).toBe('ack');
    expect(outcome.result.changes.seatBecameAvailable).toBe(false);
    expect(outcome.result.emailsSent).toBe(0);
  });

  it('handles old-state DB read throwing gracefully: returns retry, no further processing', async () => {
    vi.mocked(readSectionCheckState).mockRejectedValue(new Error('Connection timeout'));

    const outcome = await processSection(db, { class_nbr: '42737', term: '2261' }, buildEnv());

    expect(detectChanges).not.toHaveBeenCalled();
    expect(fetchClassFromASU).not.toHaveBeenCalled();
    expect(sendSectionNotifications).not.toHaveBeenCalled();
    expect(upsertClassState).not.toHaveBeenCalled();
    expect(outcome.disposition).toBe('retry');
    expect(outcome.httpStatus).toBe(500);
    expect(outcome.retryable).toBe(true);
    expect(outcome.result.success).toBe(false);
    expect(outcome.result.error).toEqual(expect.stringContaining('Connection timeout'));
  });

  describe('send/persist ordering', () => {
    it('does NOT send notifications when the state upsert fails (persist before send)', async () => {
      setupOldStateMock(defaultOldStateRow());
      vi.mocked(upsertClassState).mockRejectedValue(new Error('upsert exploded'));

      vi.mocked(fetchClassFromASU).mockResolvedValue(
        mockClassDetails({ seats_available: 5, non_reserved_seats: 5 })
      );
      vi.mocked(detectChanges).mockReturnValue(
        buildChangeResult({ seatBecameAvailable: true, newOpenSeats: 5 })
      );

      const outcome = await processSection(db, { class_nbr: '42737', term: '2261' }, buildEnv());

      expect(sendSectionNotifications).not.toHaveBeenCalled();
      expect(outcome).toMatchObject({
        disposition: 'retry',
        result: expect.objectContaining({
          success: false,
          error: expect.stringContaining('upsert exploded'),
        }),
      });
    });
  });

  describe('disposition via processSection', () => {
    it('acks a successful outcome', async () => {
      const outcome = await processSection(db, { class_nbr: '12345', term: '2261' }, buildEnv());
      expect(outcome.disposition).toBe('ack');
      expect(outcome.httpStatus).toBe(200);
      expect(outcome.retryable).toBe(false);
    });

    it('retries a failed outcome (DB upsert error)', async () => {
      vi.mocked(upsertClassState).mockRejectedValue(new Error('upsert fail'));

      const outcome = await processSection(db, { class_nbr: '12345', term: '2261' }, buildEnv());
      expect(outcome.disposition).toBe('retry');
      expect(outcome.httpStatus).toBe(500);
      expect(outcome.retryable).toBe(true);
    });

    it('acks a thrown AuthError (non-retryable: bad token)', async () => {
      vi.mocked(fetchClassFromASU).mockRejectedValue(new AuthError('401 Unauthorized from ASU'));
      const outcome = await processSection(db, { class_nbr: '12345', term: '2261' }, buildEnv());
      expect(outcome.disposition).toBe('ack');
      expect(outcome.httpStatus).toBe(200);
      expect(outcome.retryable).toBe(false);
      expect(outcome.result.retirement).toBeUndefined();
    });

    it('acks a thrown NotFoundError (non-retryable: section gone)', async () => {
      vi.mocked(fetchClassFromASU).mockRejectedValue(new NotFoundError('Section 99999 not found'));
      const outcome = await processSection(db, { class_nbr: '12345', term: '2261' }, buildEnv());
      expect(outcome.disposition).toBe('ack');
      expect(outcome.httpStatus).toBe(200);
      expect(outcome.retryable).toBe(false);
    });

    it('retries a thrown RateLimitError (transient upstream)', async () => {
      vi.mocked(fetchClassFromASU).mockRejectedValue(new RateLimitError('Rate limit exceeded'));
      const outcome = await processSection(db, { class_nbr: '12345', term: '2261' }, buildEnv());
      expect(outcome.disposition).toBe('retry');
      expect(outcome.httpStatus).toBe(429);
      expect(outcome.retryable).toBe(true);
    });

    it('retries a thrown ApiError (upstream failure)', async () => {
      vi.mocked(fetchClassFromASU).mockRejectedValue(new ApiError('ASU API 502 Bad Gateway', 502));
      const outcome = await processSection(db, { class_nbr: '12345', term: '2261' }, buildEnv());
      expect(outcome.disposition).toBe('retry');
      expect(outcome.httpStatus).toBe(502);
      expect(outcome.retryable).toBe(true);
    });

    it('retries an unknown thrown Error (defensive)', async () => {
      vi.mocked(fetchClassFromASU).mockRejectedValue(new Error('Unexpected internal error'));
      const outcome = await processSection(db, { class_nbr: '12345', term: '2261' }, buildEnv());
      expect(outcome.disposition).toBe('retry');
      expect(outcome.httpStatus).toBe(500);
      expect(outcome.retryable).toBe(true);
    });

    it('retries an unknown thrown non-Error value (defensive)', async () => {
      // eslint-disable-next-line anti-slop/no-chained-type-assertions
      vi.mocked(fetchClassFromASU).mockRejectedValue('boom' as unknown as Error);
      const outcome = await processSection(db, { class_nbr: '12345', term: '2261' }, buildEnv());
      expect(outcome.disposition).toBe('retry');
      expect(outcome.httpStatus).toBe(500);
      expect(outcome.retryable).toBe(true);

      vi.mocked(fetchClassFromASU).mockRejectedValue(
        // eslint-disable-next-line anti-slop/no-chained-type-assertions
        undefined as unknown as Error
      );
      const outcome2 = await processSection(db, { class_nbr: '12345', term: '2261' }, buildEnv());
      expect(outcome2.disposition).toBe('retry');

      // eslint-disable-next-line anti-slop/no-chained-type-assertions
      vi.mocked(fetchClassFromASU).mockRejectedValue(null as unknown as Error);
      const outcome3 = await processSection(db, { class_nbr: '12345', term: '2261' }, buildEnv());
      expect(outcome3.disposition).toBe('retry');
    });

    it('AuthError is acked even though it extends ApiError (subclass ordering)', async () => {
      vi.mocked(fetchClassFromASU).mockRejectedValue(new AuthError('401'));
      const outcome = await processSection(db, { class_nbr: '12345', term: '2261' }, buildEnv());
      expect(outcome.disposition).toBe('ack');
      expect(outcome.httpStatus).toBe(200);
    });
  });

  describe('auto-cleanup: 3-strikes NotFound handling', () => {
    it('first NotFound -> increments count to 1, ack, no deletion, no retry', async () => {
      setupOldStateMock(defaultOldStateRow());
      vi.mocked(fetchClassFromASU).mockRejectedValue(new NotFoundError('Section 42737 not found'));
      vi.mocked(incrementConsecutiveNotFound).mockResolvedValue(1);

      const env = buildEnv();
      const outcome = await processSection(db, { class_nbr: '42737', term: '2261' }, env);

      expect(incrementConsecutiveNotFound).toHaveBeenCalledWith(db, {
        class_nbr: '42737',
        term: '2261',
      });
      expect(incrementConsecutiveNotFound).toHaveBeenCalledTimes(1);
      expect(deleteSectionAndWatches).not.toHaveBeenCalled();
      expect(getClassWatchers).not.toHaveBeenCalled();
      expect(env.EMAIL.send).not.toHaveBeenCalled();
      expect(upsertClassState).not.toHaveBeenCalled();
      expect(outcome.disposition).toBe('ack');
      expect(outcome.httpStatus).toBe(200);
      expect(outcome.retryable).toBe(false);
      expect(outcome.result.success).toBe(false);
      expect(outcome.result.error).toBe('Section 42737 not found');
      expect(outcome.result.emailsSent).toBe(0);
      expect(readAutoCleanupBreakerCounts).not.toHaveBeenCalled();
      expect(capConsecutiveNotFound).not.toHaveBeenCalled();
      expect(readSectionRemovalClassInfo).not.toHaveBeenCalled();
    });

    it('second consecutive NotFound -> count 2, ack, no deletion', async () => {
      setupOldStateMock(defaultOldStateRow());
      vi.mocked(fetchClassFromASU).mockRejectedValue(new NotFoundError('Section 42737 not found'));
      vi.mocked(incrementConsecutiveNotFound).mockResolvedValue(2);

      const env = buildEnv();
      const outcome = await processSection(db, { class_nbr: '42737', term: '2261' }, env);

      expect(incrementConsecutiveNotFound).toHaveBeenCalledWith(db, {
        class_nbr: '42737',
        term: '2261',
      });
      expect(deleteSectionAndWatches).not.toHaveBeenCalled();
      expect(env.EMAIL.send).not.toHaveBeenCalled();
      expect(outcome.disposition).toBe('ack');
      expect(outcome.httpStatus).toBe(200);
      expect(outcome.result.success).toBe(false);
      expect(outcome.result.error).toBe('Section 42737 not found');
      expect(outcome.result.retirement).toMatchObject({
        status: 'tracked',
        strikeCount: 2,
        deleted: false,
      });
    });

    it('third consecutive NotFound with watchers -> deletes SectionRef-scoped watches and state, notifies watchers, ack with Auto-cleanup error', async () => {
      setupAutoCleanupMocks({
        total: 10,
        flagged: 1,
        oldStateRow: defaultOldStateRow(),
        classInfo: { subject: 'CSE', catalog_nbr: '110', title: 'Principles of Programming' },
      });
      vi.mocked(fetchClassFromASU).mockRejectedValue(new NotFoundError('Section 42737 not found'));
      vi.mocked(incrementConsecutiveNotFound).mockResolvedValue(3);
      vi.mocked(getClassWatchers).mockResolvedValue([
        { user_id: 'u1', email: 'alice@example.com', watch_id: 'w1' },
        { user_id: 'u2', email: 'bob@example.com', watch_id: 'w2' },
      ]);
      vi.mocked(deleteSectionAndWatches).mockResolvedValue({
        watchesDeleted: 2,
        stateDeleted: true,
      });

      const env = buildEnv();
      const outcome = await processSection(db, { class_nbr: '42737', term: '2261' }, env);

      expect(incrementConsecutiveNotFound).toHaveBeenCalledWith(db, {
        class_nbr: '42737',
        term: '2261',
      });
      expect(deleteSectionAndWatches).toHaveBeenCalledWith(db, {
        class_nbr: '42737',
        term: '2261',
      });
      expect(deleteSectionAndWatches).toHaveBeenCalledTimes(1);
      expect(getClassWatchers).toHaveBeenCalledWith(db, { class_nbr: '42737', term: '2261' });
      expect(readAutoCleanupBreakerCounts).toHaveBeenCalledTimes(1);
      expect(readSectionRemovalClassInfo).toHaveBeenCalledWith(db, {
        class_nbr: '42737',
        term: '2261',
      });
      expect(capConsecutiveNotFound).not.toHaveBeenCalled();

      expect(env.EMAIL.send).toHaveBeenCalledTimes(2);
      const firstSend = vi.mocked(env.EMAIL.send).mock.calls[0][0] as {
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
      const secondSend = vi.mocked(env.EMAIL.send).mock.calls[1][0] as { to: string };
      expect(secondSend.to).toBe('bob@example.com');

      expect(outcome.disposition).toBe('ack');
      expect(outcome.httpStatus).toBe(200);
      expect(outcome.result.success).toBe(true);
      expect(outcome.result.error).toBe('Auto-cleanup: class removed after 3 NotFounds');
      expect(outcome.result.emailsSent).toBe(2);
      expect(outcome.result.classNbr).toBe('42737');
      expect(outcome.result.retirement).toMatchObject({
        status: 'retired',
        strikeCount: 3,
        suppressed: false,
        deleted: true,
        watchesDeleted: 2,
        emailsAttempted: 2,
        emailsSucceeded: 2,
      });
    });

    it('third consecutive NotFound with zero watchers -> still deletes state with no email', async () => {
      setupAutoCleanupMocks({
        total: 20,
        flagged: 2,
        oldStateRow: defaultOldStateRow(),
        classInfo: { subject: 'CSE', catalog_nbr: '240', title: 'Intro' },
      });
      vi.mocked(fetchClassFromASU).mockRejectedValue(new NotFoundError('Section 99999 not found'));
      vi.mocked(incrementConsecutiveNotFound).mockResolvedValue(3);
      vi.mocked(getClassWatchers).mockResolvedValue([]);
      vi.mocked(deleteSectionAndWatches).mockResolvedValue({
        watchesDeleted: 0,
        stateDeleted: true,
      });

      const env = buildEnv();
      const outcome = await processSection(db, { class_nbr: '99999', term: '2261' }, env);

      expect(incrementConsecutiveNotFound).toHaveBeenCalledWith(db, {
        class_nbr: '99999',
        term: '2261',
      });
      expect(deleteSectionAndWatches).toHaveBeenCalledWith(db, {
        class_nbr: '99999',
        term: '2261',
      });
      expect(env.EMAIL.send).not.toHaveBeenCalled();
      expect(outcome.disposition).toBe('ack');
      expect(outcome.result.error).toBe('Auto-cleanup: class removed after 3 NotFounds');
      expect(outcome.result.emailsSent).toBe(0);
      expect(outcome.result.success).toBe(true);
      expect(readSectionRemovalClassInfo).toHaveBeenCalledWith(db, {
        class_nbr: '99999',
        term: '2261',
      });
      expect(outcome.result.retirement).toMatchObject({
        status: 'retired',
        strikeCount: 3,
        deleted: true,
        watchesDeleted: 0,
        emailsAttempted: 0,
        emailsSucceeded: 0,
      });
    });

    it('success after NotFounds -> resets count to 0 via upsertClassState', async () => {
      setupOldStateMock(defaultOldStateRow());
      vi.mocked(fetchClassFromASU).mockResolvedValue(
        mockClassDetails({ seats_available: 5, non_reserved_seats: 3 })
      );
      vi.mocked(detectChanges).mockReturnValue(buildChangeResult());

      const env = buildEnv();
      const outcome = await processSection(db, { class_nbr: '42737', term: '2261' }, env);

      expect(upsertClassState).toHaveBeenCalledWith(
        db,
        { class_nbr: '42737', term: '2261' },
        expect.objectContaining({ subject: 'CSE', seats_available: 5, non_reserved_seats: 3 })
      );
      expect(incrementConsecutiveNotFound).not.toHaveBeenCalled();
      expect(deleteSectionAndWatches).not.toHaveBeenCalled();
      expect(outcome.disposition).toBe('ack');
      expect(outcome.result.success).toBe(true);
    });

    it('RateLimitError (429) does NOT increment NotFound count and returns retry', async () => {
      vi.mocked(fetchClassFromASU).mockRejectedValue(new RateLimitError('Rate limit hit'));

      const outcome = await processSection(db, { class_nbr: '42737', term: '2261' }, buildEnv());

      expect(incrementConsecutiveNotFound).not.toHaveBeenCalled();
      expect(deleteSectionAndWatches).not.toHaveBeenCalled();
      expect(getClassWatchers).not.toHaveBeenCalled();
      expect(outcome.disposition).toBe('retry');
      expect(outcome.httpStatus).toBe(429);
      expect(outcome.retryable).toBe(true);
      expect(outcome.result.error).toBe('Rate limit hit');
      expect(outcome.result.retirement).toBeUndefined();
    });

    it('ApiError 502 does NOT increment NotFound count and returns retry', async () => {
      vi.mocked(fetchClassFromASU).mockRejectedValue(new ApiError('ASU API 502 Bad Gateway', 502));

      const outcome = await processSection(db, { class_nbr: '42737', term: '2261' }, buildEnv());

      expect(incrementConsecutiveNotFound).not.toHaveBeenCalled();
      expect(deleteSectionAndWatches).not.toHaveBeenCalled();
      expect(outcome.disposition).toBe('retry');
      expect(outcome.httpStatus).toBe(502);
      expect(outcome.retryable).toBe(true);
      expect(outcome.result.error).toBe('ASU API 502 Bad Gateway');
    });

    it('timeout ApiError (408) does NOT increment NotFound count and returns retry', async () => {
      vi.mocked(fetchClassFromASU).mockRejectedValue(
        new ApiError('ASU API request timed out', 408)
      );

      const outcome = await processSection(db, { class_nbr: '42737', term: '2261' }, buildEnv());

      expect(incrementConsecutiveNotFound).not.toHaveBeenCalled();
      expect(deleteSectionAndWatches).not.toHaveBeenCalled();
      expect(outcome.disposition).toBe('retry');
      expect(outcome.httpStatus).toBe(502);
      expect(outcome.retryable).toBe(true);
      expect(outcome.result.error).toBe('ASU API request timed out');
    });

    it('AuthError still ack without increment (existing behavior)', async () => {
      vi.mocked(fetchClassFromASU).mockRejectedValue(new AuthError('401 Unauthorized from ASU'));

      const outcome = await processSection(db, { class_nbr: '12345', term: '2261' }, buildEnv());

      expect(incrementConsecutiveNotFound).not.toHaveBeenCalled();
      expect(deleteSectionAndWatches).not.toHaveBeenCalled();
      expect(outcome.disposition).toBe('ack');
      expect(outcome.httpStatus).toBe(200);
      expect(outcome.retryable).toBe(false);
      expect(outcome.result.success).toBe(false);
      expect(outcome.result.error).toBe('401 Unauthorized from ASU');
    });

    it('term scoping: increment for 76337/2261 does NOT affect 76337/2257', async () => {
      setupOldStateMock(defaultOldStateRow({ class_nbr: '76337', term: '2261' }));
      vi.mocked(fetchClassFromASU).mockRejectedValue(new NotFoundError('Section 76337 not found'));
      vi.mocked(incrementConsecutiveNotFound).mockResolvedValue(1);

      const env = buildEnv();
      await processSection(db, { class_nbr: '76337', term: '2261' }, env);

      expect(incrementConsecutiveNotFound).toHaveBeenCalledWith(db, {
        class_nbr: '76337',
        term: '2261',
      });
      expect(incrementConsecutiveNotFound).not.toHaveBeenCalledWith(db, {
        class_nbr: '76337',
        term: '2257',
      });
      expect(readSectionCheckState).toHaveBeenCalledWith(db, { class_nbr: '76337', term: '2261' });

      vi.clearAllMocks();
      setupOldStateMock(defaultOldStateRow({ class_nbr: '76337', term: '2257' }));
      vi.mocked(fetchClassFromASU).mockRejectedValue(new NotFoundError('Section 76337 not found'));
      vi.mocked(incrementConsecutiveNotFound).mockResolvedValue(1);
      vi.mocked(deleteSectionAndWatches).mockResolvedValue({
        watchesDeleted: 0,
        stateDeleted: true,
      });
      vi.mocked(getClassWatchers).mockResolvedValue([]);

      await processSection(db, { class_nbr: '76337', term: '2257' }, env);

      expect(incrementConsecutiveNotFound).toHaveBeenCalledWith(db, {
        class_nbr: '76337',
        term: '2257',
      });
      expect(readSectionCheckState).toHaveBeenCalledWith(db, { class_nbr: '76337', term: '2257' });
      expect(incrementConsecutiveNotFound).not.toHaveBeenCalledWith(db, {
        class_nbr: '76337',
        term: '2261',
      });
    });

    it('circuit breaker: ratio >0.2 suppresses deletion, caps count at 2, logs suppressed, ack without deletion', async () => {
      setupAutoCleanupMocks({
        total: 10,
        flagged: 5,
        oldStateRow: defaultOldStateRow(),
        classInfo: null,
      });
      vi.mocked(fetchClassFromASU).mockRejectedValue(new NotFoundError('Section 42737 not found'));
      vi.mocked(incrementConsecutiveNotFound).mockResolvedValue(3);
      vi.mocked(getClassWatchers).mockResolvedValue([
        { user_id: 'u1', email: 'alice@example.com', watch_id: 'w1' },
      ]);
      vi.mocked(deleteSectionAndWatches).mockResolvedValue({
        watchesDeleted: 1,
        stateDeleted: true,
      });

      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const env = buildEnv();
      const outcome = await processSection(db, { class_nbr: '42737', term: '2261' }, env);

      expect(deleteSectionAndWatches).not.toHaveBeenCalled();
      expect(getClassWatchers).not.toHaveBeenCalled();
      expect(env.EMAIL.send).not.toHaveBeenCalled();

      expect(capConsecutiveNotFound).toHaveBeenCalledTimes(1);
      expect(capConsecutiveNotFound).toHaveBeenCalledWith(
        db,
        { class_nbr: '42737', term: '2261' },
        2
      );
      expect(readAutoCleanupBreakerCounts).toHaveBeenCalledTimes(1);
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
      expect(outcome.result.error).toBe('Section 42737 not found');
      expect(outcome.result.retirement).toMatchObject({
        status: 'suppressed',
        strikeCount: 3,
        suppressed: true,
        deleted: false,
        watchesDeleted: 0,
        emailsAttempted: 0,
        emailsSucceeded: 0,
      });
    });

    it('breaker ratio exactly 0.2 does NOT suppress (threshold is >0.2)', async () => {
      setupAutoCleanupMocks({
        total: 10,
        flagged: 2,
        oldStateRow: defaultOldStateRow(),
        classInfo: { subject: 'CSE', catalog_nbr: '110', title: 'T' },
      });
      vi.mocked(fetchClassFromASU).mockRejectedValue(new NotFoundError('Section 42737 not found'));
      vi.mocked(incrementConsecutiveNotFound).mockResolvedValue(3);
      vi.mocked(getClassWatchers).mockResolvedValue([
        { user_id: 'u1', email: 'a@example.com', watch_id: 'w1' },
      ]);
      vi.mocked(deleteSectionAndWatches).mockResolvedValue({
        watchesDeleted: 1,
        stateDeleted: true,
      });

      const env = buildEnv();
      const outcome = await processSection(db, { class_nbr: '42737', term: '2261' }, env);

      expect(deleteSectionAndWatches).toHaveBeenCalled();
      expect(outcome.result.error).toContain('Auto-cleanup');
      expect(outcome.result.emailsSent).toBe(1);
      expect(outcome.result.retirement).toMatchObject({
        status: 'retired',
        suppressed: false,
        deleted: true,
        strikeCount: 3,
        watchesDeleted: 1,
        emailsAttempted: 1,
        emailsSucceeded: 1,
      });
    });

    it('increment failure: ack without deletion, no throw', async () => {
      setupOldStateMock(defaultOldStateRow());
      vi.mocked(fetchClassFromASU).mockRejectedValue(new NotFoundError('Section 42737 not found'));
      vi.mocked(incrementConsecutiveNotFound).mockRejectedValue(new Error('DB down'));

      const outcome = await processSection(db, { class_nbr: '42737', term: '2261' }, buildEnv());

      expect(outcome.disposition).toBe('ack');
      expect(outcome.httpStatus).toBe(200);
      expect(outcome.result.success).toBe(false);
      expect(deleteSectionAndWatches).not.toHaveBeenCalled();
      expect(outcome.result.retirement).toMatchObject({
        status: 'increment-failed',
        strikeCount: null,
        deleted: false,
        watchesDeleted: 0,
        emailsAttempted: 0,
        emailsSucceeded: 0,
      });
    });

    it('breaker-count read failure fails open: proceeds with deletion and retires', async () => {
      setupAutoCleanupMocks({
        total: 10,
        flagged: 1,
        oldStateRow: defaultOldStateRow(),
        classInfo: { subject: 'CSE', catalog_nbr: '110', title: 'T' },
      });
      vi.mocked(fetchClassFromASU).mockRejectedValue(new NotFoundError('Section 42737 not found'));
      vi.mocked(incrementConsecutiveNotFound).mockResolvedValue(3);
      vi.mocked(readAutoCleanupBreakerCounts).mockRejectedValue(new Error('breaker query down'));
      vi.mocked(getClassWatchers).mockResolvedValue([
        { user_id: 'u1', email: 'a@example.com', watch_id: 'w1' },
      ]);
      vi.mocked(deleteSectionAndWatches).mockResolvedValue({
        watchesDeleted: 1,
        stateDeleted: true,
      });

      const outcome = await processSection(db, { class_nbr: '42737', term: '2261' }, buildEnv());

      expect(deleteSectionAndWatches).toHaveBeenCalledTimes(1);
      expect(outcome.disposition).toBe('ack');
      expect(outcome.result.success).toBe(true);
      expect(outcome.result.emailsSent).toBe(1);
      expect(outcome.result.retirement).toMatchObject({
        status: 'retired',
        deleted: true,
        watchesDeleted: 1,
        emailsAttempted: 1,
        emailsSucceeded: 1,
      });
    });

    it('watcher read failure: ack, no deletion, no email, watcher-read-failed status', async () => {
      setupAutoCleanupMocks();
      vi.mocked(fetchClassFromASU).mockRejectedValue(new NotFoundError('Section 42737 not found'));
      vi.mocked(incrementConsecutiveNotFound).mockResolvedValue(3);
      vi.mocked(getClassWatchers).mockRejectedValue(new Error('watcher RPC exploded'));

      const env = buildEnv();
      const outcome = await processSection(db, { class_nbr: '42737', term: '2261' }, env);

      expect(deleteSectionAndWatches).not.toHaveBeenCalled();
      expect(env.EMAIL.send).not.toHaveBeenCalled();
      expect(outcome.disposition).toBe('ack');
      expect(outcome.httpStatus).toBe(200);
      expect(outcome.result.success).toBe(false);
      expect(outcome.result.error).toBe('Section 42737 not found');
      expect(outcome.result.retirement).toMatchObject({
        status: 'watcher-read-failed',
        strikeCount: 3,
        deleted: false,
        watchesDeleted: 0,
        emailsAttempted: 0,
        emailsSucceeded: 0,
      });
    });

    it('delete failure: ack, no email sent (deletion before email), delete-failed status', async () => {
      setupAutoCleanupMocks();
      vi.mocked(fetchClassFromASU).mockRejectedValue(new NotFoundError('Section 42737 not found'));
      vi.mocked(incrementConsecutiveNotFound).mockResolvedValue(3);
      vi.mocked(getClassWatchers).mockResolvedValue([
        { user_id: 'u1', email: 'a@example.com', watch_id: 'w1' },
      ]);
      vi.mocked(deleteSectionAndWatches).mockRejectedValue(new Error('delete statement timeout'));

      const env = buildEnv();
      const outcome = await processSection(db, { class_nbr: '42737', term: '2261' }, env);

      expect(env.EMAIL.send).not.toHaveBeenCalled();
      expect(outcome.disposition).toBe('ack');
      expect(outcome.httpStatus).toBe(200);
      expect(outcome.result.success).toBe(false);
      expect(outcome.result.error).toBe('Section 42737 not found');
      expect(outcome.result.retirement).toMatchObject({
        status: 'delete-failed',
        strikeCount: 3,
        deleted: false,
        watchesDeleted: 0,
        emailsAttempted: 0,
        emailsSucceeded: 0,
      });
    });

    it('partial email failures: emailsSent equals actual successes, deletion still stands', async () => {
      setupAutoCleanupMocks({
        total: 10,
        flagged: 1,
        oldStateRow: defaultOldStateRow(),
        classInfo: { subject: 'CSE', catalog_nbr: '110', title: 'T' },
      });
      vi.mocked(fetchClassFromASU).mockRejectedValue(new NotFoundError('Section 42737 not found'));
      vi.mocked(incrementConsecutiveNotFound).mockResolvedValue(3);
      vi.mocked(getClassWatchers).mockResolvedValue([
        { user_id: 'u1', email: 'ok1@example.com', watch_id: 'w1' },
        { user_id: 'u2', email: 'bounce@example.com', watch_id: 'w2' },
        { user_id: 'u3', email: 'ok2@example.com', watch_id: 'w3' },
      ]);
      vi.mocked(deleteSectionAndWatches).mockResolvedValue({
        watchesDeleted: 3,
        stateDeleted: true,
      });

      const env = buildEnv();
      vi.mocked(env.EMAIL.send).mockRejectedValueOnce(new Error('SMTP 550 mailbox unavailable'));

      const outcome = await processSection(db, { class_nbr: '42737', term: '2261' }, env);

      expect(env.EMAIL.send).toHaveBeenCalledTimes(3);
      expect(outcome.disposition).toBe('ack');
      expect(outcome.result.success).toBe(true);
      expect(outcome.result.error).toBe('Auto-cleanup: class removed after 3 NotFounds');
      expect(outcome.result.emailsSent).toBe(2);
      expect(outcome.result.retirement).toMatchObject({
        status: 'retired',
        deleted: true,
        watchesDeleted: 3,
        emailsAttempted: 3,
        emailsSucceeded: 2,
      });
    });

    it('caps watchers at AUTO_CLEANUP_MAX_EMAILS_PER_CYCLE and truncates emails, logs warn', async () => {
      const cap = AUTO_CLEANUP_MAX_EMAILS_PER_CYCLE;
      const overCap = cap + 100;
      const manyWatchers = Array.from({ length: overCap }, (_, i) => ({
        user_id: `u${i}`,
        email: `user${i}@example.com`,
        watch_id: `w${i}`,
      }));
      setupAutoCleanupMocks({
        total: 1000,
        flagged: 10,
        oldStateRow: defaultOldStateRow(),
        classInfo: { subject: 'CSE', catalog_nbr: '110', title: 'Principles of Programming' },
      });
      vi.mocked(fetchClassFromASU).mockRejectedValue(new NotFoundError('Section 42737 not found'));
      vi.mocked(incrementConsecutiveNotFound).mockResolvedValue(3);
      vi.mocked(getClassWatchers).mockResolvedValue(manyWatchers);
      vi.mocked(deleteSectionAndWatches).mockResolvedValue({
        watchesDeleted: overCap,
        stateDeleted: true,
      });

      vi.spyOn(console, 'warn').mockImplementation(() => {});
      vi.spyOn(globalThis, 'setTimeout').mockImplementation((cb: () => void) => {
        cb();
        // eslint-disable-next-line anti-slop/no-chained-type-assertions
        return {} as unknown as ReturnType<typeof setTimeout>;
      });

      const env = buildEnv();
      const outcome = await processSection(db, { class_nbr: '42737', term: '2261' }, env);

      expect(deleteSectionAndWatches).toHaveBeenCalledWith(db, {
        class_nbr: '42737',
        term: '2261',
      });
      expect(env.EMAIL.send).toHaveBeenCalledTimes(cap);
      const { retirement } = outcome.result;
      expect(retirement).toBeDefined();
      if (!retirement) throw new Error('expected retirement payload');
      expect(retirement.watchesDeleted).toBe(overCap);
      expect(overCap).toBeGreaterThan(cap);
      expect(overCap).toBe(manyWatchers.length);
      expect(retirement.emailsAttempted).toBe(cap);
      expect(retirement.emailsSucceeded).toBe(cap);
      expect(retirement.status).toBe('retired');
      expect(outcome.result.emailsSent).toBe(cap);
      expect(outcome.result.success).toBe(true);
      expect(outcome.result.error).toContain('Auto-cleanup');
      expect(outcome.result.error).toContain('3');
      expect(outcome.result.retirement).toMatchObject({
        strikeCount: 3,
        suppressed: false,
        deleted: true,
      });
      const warnCalls = vi
        .mocked(console.warn)
        .mock.calls.map((c) => String(c[0]) + ' ' + String(c[1] ?? ''));
      expect(warnCalls.some((s) => s.includes('exceeds cap') && s.includes('truncating'))).toBe(
        true
      );
    });

    it('breaker check logs total flagged ratio before suppression decision', async () => {
      setupAutoCleanupMocks({
        total: 100,
        flagged: 5,
        oldStateRow: defaultOldStateRow(),
        classInfo: { subject: 'CSE', catalog_nbr: '110', title: 'T' },
      });
      vi.mocked(fetchClassFromASU).mockRejectedValue(new NotFoundError('Section 42737 not found'));
      vi.mocked(incrementConsecutiveNotFound).mockResolvedValue(3);
      vi.mocked(getClassWatchers).mockResolvedValue([
        { user_id: 'u1', email: 'a@example.com', watch_id: 'w1' },
      ]);
      vi.mocked(deleteSectionAndWatches).mockResolvedValue({
        watchesDeleted: 1,
        stateDeleted: true,
      });

      const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
      const env = buildEnv();
      await processSection(db, { class_nbr: '42737', term: '2261' }, env);

      const infoCalls = infoSpy.mock.calls.map((c) => String(c[0]) + ' ' + String(c[1] ?? ''));
      expect(
        infoCalls.some((s) => s.includes('Breaker check total=100 flagged=5 ratio=0.050'))
      ).toBe(true);
    });

    it('breaker tripped also logs ratio info and warn suppressed', async () => {
      setupAutoCleanupMocks({
        total: 100,
        flagged: 30,
        oldStateRow: defaultOldStateRow(),
        classInfo: null,
      });
      vi.mocked(fetchClassFromASU).mockRejectedValue(new NotFoundError('Section 42737 not found'));
      vi.mocked(incrementConsecutiveNotFound).mockResolvedValue(3);

      const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const env = buildEnv();
      const outcome = await processSection(db, { class_nbr: '42737', term: '2261' }, env);

      const infoCalls = infoSpy.mock.calls.map((c) => String(c[0]) + ' ' + String(c[1] ?? ''));
      expect(
        infoCalls.some((s) => s.includes('Breaker check total=100 flagged=30 ratio=0.300'))
      ).toBe(true);
      const warnCalls = warnSpy.mock.calls.map((c) => String(c[0]) + ' ' + String(c[1] ?? ''));
      expect(warnCalls.some((s) => s.includes('Auto-cleanup suppressed'))).toBe(true);
      expect(deleteSectionAndWatches).not.toHaveBeenCalled();
      expect(outcome.result.success).toBe(false);
      expect(outcome.result.retirement).toMatchObject({
        status: 'suppressed',
        suppressed: true,
        strikeCount: 3,
        deleted: false,
      });
    });
  });
});
