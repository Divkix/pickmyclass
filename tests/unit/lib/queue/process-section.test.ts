import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import { AUTO_CLEANUP_MAX_EMAILS_PER_CYCLE } from '@/lib/config';

// Mock all dependencies
vi.mock('@/lib/db/client', () => ({
  queryOne: vi.fn(),
  queryScalar: vi.fn(),
  execute: vi.fn(),
  query: vi.fn(),
  callFunction: vi.fn(),
  callFunctionScalar: vi.fn(),
  getClient: vi.fn(),
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
  upsertClassState: vi.fn(),
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
import { execute, queryOne, queryScalar } from '@/lib/db/client';
import {
  deleteSectionAndWatches,
  getClassWatchers,
  incrementConsecutiveNotFound,
  resetNotificationsForSection,
  upsertClassState,
} from '@/lib/db/queries';
import type { ChangeResult } from '@/lib/queue/change-detector';
import { detectChanges } from '@/lib/queue/change-detector';
import { sendSectionNotifications } from '@/lib/queue/notification-sender';
import { processSection } from '@/lib/queue/process-section';
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
    // eslint-disable-next-line anti-slop/no-chained-type-assertions -- SAFETY: test double constructs minimal SendEmail shape for queue processing; only send is accessed
    EMAIL: { send: vi.fn().mockResolvedValue({ messageId: 'msg_test' }) } as unknown as SendEmail,
    NOTIFICATION_FROM_EMAIL: 'notifications@pickmyclass.app',
  };
}

/** Shape of the class_states row returned by the old-state fetch. */
interface OldStateRow {
  class_nbr: string;
  term: string;
  seats_available: number;
  non_reserved_seats: number | null;
  instructor_name: string | null;
  consecutive_not_found_count: number;
}

function defaultOldStateRow(overrides: Partial<OldStateRow> = {}): OldStateRow {
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

/**
 * Set up the `queryOne` mock to return the given old-state row (or null for
 * first observation) for the old-state fetch. Only the old-state fetch runs in
 * the happy path; the class-info fetch is only reached in the auto-cleanup
 * non-suppressed branch (see `setupAutoCleanupMocks`).
 */
function setupOldStateMock(row: OldStateRow | null): void {
  vi.mocked(queryOne).mockResolvedValue(row);
}

/**
 * Set up mocks for the 3-strikes auto-cleanup breaker flow:
 * - `queryScalar` returns `total` then `flagged` (the two breaker count queries).
 * - `queryOne` discriminates the old-state fetch from the class-info fetch by
 *   SQL text (class-info selects `subject, catalog_nbr, title`).
 * - `execute` returns an affected-row count for the cap update (suppressed path).
 */
function setupAutoCleanupMocks(
  opts: {
    total?: number;
    flagged?: number;
    oldStateRow?: OldStateRow | null;
    classInfo?: {
      subject?: string | null;
      catalog_nbr?: string | null;
      title?: string | null;
    } | null;
  } = {}
): void {
  const {
    total = 10,
    flagged = 1,
    oldStateRow = defaultOldStateRow(),
    classInfo = { subject: 'CSE', catalog_nbr: '110', title: 'Principles of Programming' },
  } = opts;

  vi.mocked(queryScalar).mockResolvedValueOnce(total).mockResolvedValueOnce(flagged);

  // SAFETY: test double — implementation discriminates old-state vs class-info fetch by SQL text; cast aligns the non-generic mock return with queryOne's generic signature
  vi.mocked(queryOne).mockImplementation(((sql: string) => {
    if (sql.includes('subject, catalog_nbr, title')) {
      return Promise.resolve(classInfo);
    }
    return Promise.resolve(oldStateRow);
  }) as typeof queryOne);

  vi.mocked(execute).mockResolvedValue(1);
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
    // Default auto-cleanup mocks: no deletion unless test overrides
    vi.mocked(incrementConsecutiveNotFound).mockResolvedValue(1);
    vi.mocked(deleteSectionAndWatches).mockResolvedValue({
      watchesDeleted: 0,
      stateDeleted: true,
    });
    vi.mocked(getClassWatchers).mockResolvedValue([]);
    // Breaker query defaults (not reached unless count >= threshold, but safe)
    vi.mocked(queryScalar).mockResolvedValue(0);
    vi.mocked(execute).mockResolvedValue(0);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('successful full flow: fetches, detects, notifies, and persists', async () => {
    const env = buildEnv();
    const outcome = await processSection({ class_nbr: '42737', term: '2261' }, env);

    // Should have fetched old state via the pg query seam (parameterized by SectionRef)
    expect(queryOne).toHaveBeenCalledWith(
      expect.stringContaining('FROM class_states WHERE class_nbr = $1 AND term = $2'),
      ['42737', '2261']
    );

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

    // Should have upserted new state via upsertClassState(ref, details)
    expect(upsertClassState).toHaveBeenCalledWith(
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
  });

  it('no changes detected: only persists, no notifications', async () => {
    vi.mocked(detectChanges).mockReturnValue(buildChangeResult());

    const outcome = await processSection({ class_nbr: '42737', term: '2261' }, buildEnv());

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
    vi.mocked(fetchClassFromASU).mockRejectedValue(new NotFoundError('Section 42737 not found'));
    // auto-cleanup increment defaults to 1 in beforeEach, so no deletion
    const outcome = await processSection({ class_nbr: '42737', term: '2261' }, buildEnv());

    expect(outcome.disposition).toBe('ack');
    expect(outcome.httpStatus).toBe(200);
    expect(outcome.retryable).toBe(false);
    expect(outcome.result.success).toBe(false);
    expect(outcome.result.error).toBe('Section 42737 not found');
    // Should NOT have tried to persist or notify
    expect(upsertClassState).not.toHaveBeenCalled();
    expect(sendSectionNotifications).not.toHaveBeenCalled();
  });

  it('ASU API throws RateLimitError: returns retry outcome (429)', async () => {
    vi.mocked(fetchClassFromASU).mockRejectedValue(new RateLimitError('Rate limit hit'));

    const outcome = await processSection({ class_nbr: '42737', term: '2261' }, buildEnv());

    expect(outcome.disposition).toBe('retry');
    expect(outcome.httpStatus).toBe(429);
    expect(outcome.retryable).toBe(true);
    expect(outcome.result.error).toBe('Rate limit hit');
  });

  it('DB upsert fails: returns retry outcome (500)', async () => {
    vi.mocked(upsertClassState).mockRejectedValue(new Error('Constraint violation'));

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
    // First observation = queryOne returns null (no rows found, not an error)
    setupOldStateMock(null);

    vi.mocked(fetchClassFromASU).mockResolvedValue(
      mockClassDetails({ seats_available: 5, non_reserved_seats: 3 })
    );

    // detectChanges would report a seat became available, but with no baseline (oldState null)
    // this is a false positive that must be suppressed.
    vi.mocked(detectChanges).mockReturnValue(
      buildChangeResult({ seatBecameAvailable: true, newOpenSeats: 3 })
    );

    const outcome = await processSection({ class_nbr: '42737', term: '2261' }, buildEnv());

    // detectChanges should have been called with null oldState (queryOne returns null)
    expect(detectChanges).toHaveBeenCalledWith(
      null,
      expect.objectContaining({ seats_available: 5 })
    );

    // First-observation suppression: NO emails sent.
    expect(sendSectionNotifications).not.toHaveBeenCalled();
    // Baseline still persisted.
    expect(upsertClassState).toHaveBeenCalledWith(
      { class_nbr: '42737', term: '2261' },
      expect.objectContaining({ seats_available: 5 })
    );
    expect(outcome.result.success).toBe(true);
    expect(outcome.disposition).toBe('ack');
    expect(outcome.result.changes.seatBecameAvailable).toBe(false);
    expect(outcome.result.emailsSent).toBe(0);
  });

  it('handles queryOne throwing a DB error gracefully: returns retry, no further processing', async () => {
    vi.mocked(queryOne).mockRejectedValue(new Error('Connection timeout'));

    const outcome = await processSection({ class_nbr: '42737', term: '2261' }, buildEnv());

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
      // oldState: no open seats. ASU: open seats available → seat became available.
      setupOldStateMock(defaultOldStateRow());
      // The class_states upsert (Step 5, now before send) fails.
      vi.mocked(upsertClassState).mockRejectedValue(new Error('upsert exploded'));

      vi.mocked(fetchClassFromASU).mockResolvedValue(
        mockClassDetails({ seats_available: 5, non_reserved_seats: 5 })
      );
      vi.mocked(detectChanges).mockReturnValue(
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
      vi.mocked(upsertClassState).mockRejectedValue(new Error('upsert fail'));

      const outcome = await processSection({ class_nbr: '12345', term: '2261' }, buildEnv());
      expect(outcome.disposition).toBe('retry');
      expect(outcome.httpStatus).toBe(500);
      expect(outcome.retryable).toBe(true);
    });

    it('acks a thrown AuthError (non-retryable: bad token)', async () => {
      vi.mocked(fetchClassFromASU).mockRejectedValue(new AuthError('401 Unauthorized from ASU'));
      const outcome = await processSection({ class_nbr: '12345', term: '2261' }, buildEnv());
      expect(outcome.disposition).toBe('ack');
      expect(outcome.httpStatus).toBe(200);
      expect(outcome.retryable).toBe(false);
    });

    it('acks a thrown NotFoundError (non-retryable: section gone)', async () => {
      vi.mocked(fetchClassFromASU).mockRejectedValue(new NotFoundError('Section 99999 not found'));
      const outcome = await processSection({ class_nbr: '12345', term: '2261' }, buildEnv());
      expect(outcome.disposition).toBe('ack');
      expect(outcome.httpStatus).toBe(200);
      expect(outcome.retryable).toBe(false);
    });

    it('retries a thrown RateLimitError (transient upstream)', async () => {
      vi.mocked(fetchClassFromASU).mockRejectedValue(new RateLimitError('Rate limit exceeded'));
      const outcome = await processSection({ class_nbr: '12345', term: '2261' }, buildEnv());
      expect(outcome.disposition).toBe('retry');
      expect(outcome.httpStatus).toBe(429);
      expect(outcome.retryable).toBe(true);
    });

    it('retries a thrown ApiError (upstream failure)', async () => {
      vi.mocked(fetchClassFromASU).mockRejectedValue(new ApiError('ASU API 502 Bad Gateway', 502));
      const outcome = await processSection({ class_nbr: '12345', term: '2261' }, buildEnv());
      expect(outcome.disposition).toBe('retry');
      expect(outcome.httpStatus).toBe(502);
      expect(outcome.retryable).toBe(true);
    });

    it('retries an unknown thrown Error (defensive)', async () => {
      vi.mocked(fetchClassFromASU).mockRejectedValue(new Error('Unexpected internal error'));
      const outcome = await processSection({ class_nbr: '12345', term: '2261' }, buildEnv());
      expect(outcome.disposition).toBe('retry');
      expect(outcome.httpStatus).toBe(500);
      expect(outcome.retryable).toBe(true);
    });

    it('retries an unknown thrown non-Error value (defensive)', async () => {
      // eslint-disable-next-line anti-slop/no-chained-type-assertions -- SAFETY: test verifies defensive handling of non-Error throw values; cast needed because string not overlapping Error
      vi.mocked(fetchClassFromASU).mockRejectedValue('boom' as unknown as Error);
      const outcome = await processSection({ class_nbr: '12345', term: '2261' }, buildEnv());
      expect(outcome.disposition).toBe('retry');
      expect(outcome.httpStatus).toBe(500);
      expect(outcome.retryable).toBe(true);

      vi.mocked(fetchClassFromASU).mockRejectedValue(
        // eslint-disable-next-line anti-slop/no-chained-type-assertions -- SAFETY: test verifies defensive handling of non-Error throw values; undefined not overlapping Error
        undefined as unknown as Error
      );
      const outcome2 = await processSection({ class_nbr: '12345', term: '2261' }, buildEnv());
      expect(outcome2.disposition).toBe('retry');

      // eslint-disable-next-line anti-slop/no-chained-type-assertions -- SAFETY: test verifies defensive handling of non-Error throw values; null not overlapping Error
      vi.mocked(fetchClassFromASU).mockRejectedValue(null as unknown as Error);
      const outcome3 = await processSection({ class_nbr: '12345', term: '2261' }, buildEnv());
      expect(outcome3.disposition).toBe('retry');
    });

    it('AuthError is acked even though it extends ApiError (subclass ordering)', async () => {
      // Ensures AuthError/NotFound check wins before ApiError base
      vi.mocked(fetchClassFromASU).mockRejectedValue(new AuthError('401'));
      const outcome = await processSection({ class_nbr: '12345', term: '2261' }, buildEnv());
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
      const outcome = await processSection({ class_nbr: '42737', term: '2261' }, env);

      expect(incrementConsecutiveNotFound).toHaveBeenCalledWith({
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
    });

    it('second consecutive NotFound -> count 2, ack, no deletion', async () => {
      setupOldStateMock(defaultOldStateRow());
      vi.mocked(fetchClassFromASU).mockRejectedValue(new NotFoundError('Section 42737 not found'));
      vi.mocked(incrementConsecutiveNotFound).mockResolvedValue(2);

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
      setupAutoCleanupMocks({
        total: 10,
        flagged: 1, // ratio 0.1 < 0.2, breaker NOT tripped
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
      // SAFETY: test reads mock call args; narrowing required because SendEmail method shape carries no mock metadata
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
      // SAFETY: test reads mock call args; narrowing required because SendEmail method shape carries no mock metadata
      const secondSend = vi.mocked(env.EMAIL.send).mock.calls[1][0] as { to: string };
      expect(secondSend.to).toBe('bob@example.com');

      expect(outcome.disposition).toBe('ack');
      expect(outcome.httpStatus).toBe(200);
      expect(outcome.result.success).toBe(true);
      expect(outcome.result.error).toContain('Auto-cleanup');
      expect(outcome.result.emailsSent).toBe(2);
      expect(outcome.result.classNbr).toBe('42737');
    });

    it('third consecutive NotFound with zero watchers -> still deletes state with no email', async () => {
      setupAutoCleanupMocks({
        total: 20,
        flagged: 2, // ratio 0.1 < 0.2
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

    it('success after NotFounds -> resets count to 0 via upsertClassState', async () => {
      setupOldStateMock(defaultOldStateRow());
      vi.mocked(fetchClassFromASU).mockResolvedValue(
        mockClassDetails({ seats_available: 5, non_reserved_seats: 3 })
      );
      vi.mocked(detectChanges).mockReturnValue(buildChangeResult());

      const env = buildEnv();
      const outcome = await processSection({ class_nbr: '42737', term: '2261' }, env);

      // upsertClassState(ref, details) owns the consecutive_not_found_count=0 reset
      // internally now (it lives inside the mocked query, no longer a payload field
      // visible to callers). Verify it was called with the SectionRef and fresh data.
      expect(upsertClassState).toHaveBeenCalledWith(
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
      vi.mocked(fetchClassFromASU).mockRejectedValue(new ApiError('ASU API 502 Bad Gateway', 502));

      const outcome = await processSection({ class_nbr: '42737', term: '2261' }, buildEnv());

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
      vi.mocked(fetchClassFromASU).mockRejectedValue(new AuthError('401 Unauthorized from ASU'));

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
      setupOldStateMock(defaultOldStateRow({ class_nbr: '76337', term: '2261' }));
      vi.mocked(fetchClassFromASU).mockRejectedValue(new NotFoundError('Section 76337 not found'));
      vi.mocked(incrementConsecutiveNotFound).mockResolvedValue(1);

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
      // Old-state fetch parameterized by SectionRef (class_nbr + term)
      expect(queryOne).toHaveBeenCalledWith(
        expect.stringContaining('class_nbr = $1 AND term = $2'),
        ['76337', '2261']
      );

      vi.clearAllMocks();
      // Re-setup mocks after clear (clearAllMocks resets implementations to no-op, so re-mock)
      setupOldStateMock(defaultOldStateRow({ class_nbr: '76337', term: '2257' }));
      vi.mocked(fetchClassFromASU).mockRejectedValue(new NotFoundError('Section 76337 not found'));
      vi.mocked(incrementConsecutiveNotFound).mockResolvedValue(1);
      vi.mocked(deleteSectionAndWatches).mockResolvedValue({
        watchesDeleted: 0,
        stateDeleted: true,
      });
      vi.mocked(getClassWatchers).mockResolvedValue([]);

      await processSection({ class_nbr: '76337', term: '2257' }, env);

      expect(incrementConsecutiveNotFound).toHaveBeenCalledWith({
        class_nbr: '76337',
        term: '2257',
      });
      expect(queryOne).toHaveBeenCalledWith(
        expect.stringContaining('class_nbr = $1 AND term = $2'),
        ['76337', '2257']
      );
      // Ensure second call used different term
      expect(incrementConsecutiveNotFound).not.toHaveBeenCalledWith({
        class_nbr: '76337',
        term: '2261',
      });
    });

    it('circuit breaker: ratio >0.2 suppresses deletion, caps count at 2, logs suppressed, ack without deletion', async () => {
      setupAutoCleanupMocks({
        total: 10,
        flagged: 5, // ratio 0.5 > 0.2 → tripped
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
      const outcome = await processSection({ class_nbr: '42737', term: '2261' }, env);

      // Even though count would be 3, deletion suppressed
      expect(deleteSectionAndWatches).not.toHaveBeenCalled();
      expect(getClassWatchers).not.toHaveBeenCalled();
      expect(env.EMAIL.send).not.toHaveBeenCalled();

      // Count capped at 2 via parameterized UPDATE with neq guard to avoid no-op WAL writes
      expect(execute).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE class_states SET consecutive_not_found_count = $1'),
        [2, '42737', '2261']
      );
      expect(queryScalar).toHaveBeenCalledWith('SELECT COUNT(*)::int AS count FROM class_states');
      expect(queryScalar).toHaveBeenCalledWith(
        'SELECT COUNT(*)::int AS count FROM class_states WHERE consecutive_not_found_count >= 1'
      );
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
      const outcome = await processSection({ class_nbr: '42737', term: '2261' }, env);

      expect(deleteSectionAndWatches).toHaveBeenCalled();
      expect(outcome.result.error).toContain('Auto-cleanup');
      expect(outcome.result.emailsSent).toBe(1);
    });

    it('increment failure: ack without deletion, no throw', async () => {
      setupOldStateMock(defaultOldStateRow());
      vi.mocked(fetchClassFromASU).mockRejectedValue(new NotFoundError('Section 42737 not found'));
      vi.mocked(incrementConsecutiveNotFound).mockRejectedValue(new Error('DB down'));

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
      setupAutoCleanupMocks({
        total: 1000,
        flagged: 10, // ratio 0.01 < 0.2, breaker NOT tripped
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
      // Speed up batch delay for 500 sends — mock setTimeout to immediate
      vi.spyOn(globalThis, 'setTimeout')
        // SAFETY: test mock — setTimeout overload narrowed to callback+delay used by auto-cleanup batch throttle
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
        flagged: 5, // ratio 0.05 < 0.2, NOT suppressed — should still log info
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
      await processSection({ class_nbr: '42737', term: '2261' }, env);

      const infoCalls = infoSpy.mock.calls.map((c) => String(c[0]) + ' ' + String(c[1] ?? ''));
      expect(
        infoCalls.some((s) => s.includes('Breaker check total=100 flagged=5 ratio=0.050'))
      ).toBe(true);

      // rely on afterEach restoreAllMocks
    });

    it('breaker tripped also logs ratio info and warn suppressed', async () => {
      setupAutoCleanupMocks({
        total: 100,
        flagged: 30, // ratio 0.30 > 0.2, suppressed
        oldStateRow: defaultOldStateRow(),
        classInfo: null,
      });
      vi.mocked(fetchClassFromASU).mockRejectedValue(new NotFoundError('Section 42737 not found'));
      vi.mocked(incrementConsecutiveNotFound).mockResolvedValue(3);

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
