import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';

import { ApiError, AuthError, NotFoundError, RateLimitError } from '@/lib/asu/api';
import { processSection } from '@/lib/queue/process-section';
import type { ClassDetails } from '@/lib/types/class';
import type { Env, SendEmail } from '@/lib/types/env';
import { createScriptedPostgres } from '../db/scripted-postgres';

const REF = { class_nbr: '42737', term: '2261' };
const FROM_EMAIL = 'notifications@pickmyclass.app';

function buildDetails(overrides: Partial<ClassDetails> = {}): ClassDetails {
  return {
    subject: 'CSE',
    catalog_nbr: '110',
    title: 'Principles of Programming',
    instructor_name: 'Dr. Smith',
    seats_available: 5,
    seats_capacity: 100,
    non_reserved_seats: 3,
    location: 'TBD',
    meeting_times: 'TBD',
    ...overrides,
  };
}

function oldStateRow(
  overrides: Partial<{
    seats_available: number;
    non_reserved_seats: number | null;
    instructor_name: string | null;
  }> = {}
) {
  return {
    class_nbr: REF.class_nbr,
    term: REF.term,
    seats_available: 0,
    non_reserved_seats: 0,
    instructor_name: 'Staff',
    consecutive_not_found_count: 0,
    ...overrides,
  };
}

function buildSend() {
  return vi.fn().mockResolvedValue({ messageId: 'msg_test' });
}

function buildEnv(
  send: ReturnType<typeof buildSend>
): Pick<Env, 'ASU_API_BASE_URL' | 'ASU_API_TOKEN' | 'EMAIL' | 'NOTIFICATION_FROM_EMAIL'> {
  return {
    ASU_API_BASE_URL: 'https://asu.example.test',
    ASU_API_TOKEN: 'test-token',
    // eslint-disable-next-line anti-slop/no-chained-type-assertions
    EMAIL: { send } as unknown as SendEmail,
    NOTIFICATION_FROM_EMAIL: FROM_EMAIL,
  };
}

function upsertStatements(h: ReturnType<typeof createScriptedPostgres>) {
  return h.statements.filter((s) => s.sql.includes('insert into "class_states"'));
}

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'info').mockImplementation(() => {});
  process.env.UNSUBSCRIBE_SIGNING_SECRET = 'behavior-test-secret';
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.UNSUBSCRIBE_SIGNING_SECRET;
});

describe('processSection behavior (interface only)', () => {
  it('first observation persists the baseline but suppresses seat and instructor email', async () => {
    const h = createScriptedPostgres();
    h.next([]); // readSectionCheckState -> no row yet
    h.next([]); // upsertClassState baseline

    const send = buildSend();
    const outcome = await processSection(h.db, REF, buildEnv(send), {
      fetchClass: async () =>
        buildDetails({
          seats_available: 5,
          non_reserved_seats: 3,
          instructor_name: 'Dr. Smith',
        }),
    });

    expect(outcome.disposition).toBe('ack');
    expect(outcome.httpStatus).toBe(200);
    expect(outcome.result.success).toBe(true);
    expect(outcome.result.emailsSent).toBe(0);
    expect(outcome.result.changes.seatBecameAvailable).toBe(false);
    expect(outcome.result.changes.instructorAssigned).toBe(false);
    expect(send).not.toHaveBeenCalled();
    const upserts = upsertStatements(h);
    expect(upserts).toHaveLength(1);
    expect(upserts[0].params).toContain(5);
  });

  it('seat opens: persists the new state before any email sends', async () => {
    const h = createScriptedPostgres();
    h.next([oldStateRow()]); // persisted baseline, section was full
    h.next([]); // upsertClassState
    h.next([{ user_id: 'user-1', email: 'alice@example.com', watch_id: 'watch-1' }]); // watchers
    h.next([{ recorded: '{watch-1}' }]); // seat_available claim

    let upsertsAtSend = -1;
    const send = buildSend();
    send.mockImplementation(async () => {
      upsertsAtSend = upsertStatements(h).length;
      return { messageId: 'msg_test' };
    });

    const outcome = await processSection(h.db, REF, buildEnv(send), {
      fetchClass: async () => buildDetails({ instructor_name: 'Staff' }),
    });

    expect(outcome.disposition).toBe('ack');
    expect(outcome.result.success).toBe(true);
    expect(outcome.result.changes).toMatchObject({
      seatBecameAvailable: true,
      newOpenSeats: 3,
    });
    expect(outcome.result.emailsSent).toBe(1);
    expect(send).toHaveBeenCalledTimes(1);
    const firstSend = send.mock.calls[0][0] as { to: string };
    expect(firstSend.to).toBe('alice@example.com');
    expect(upsertsAtSend).toBe(1);
    const upserts = upsertStatements(h);
    expect(upserts[0].params).toContain(5);
    expect(upserts[0].params).toContain(3);
  });

  it('seats fill: resets seat notifications and sends no email', async () => {
    const h = createScriptedPostgres();
    h.next([oldStateRow({ seats_available: 3, non_reserved_seats: 2 })]); // was open
    h.next([{ id: 'watch-1' }]); // class_watches rows for the reset
    h.next([{ id: 'notif-1' }]); // deleted notification rows
    h.next([]); // upsertClassState

    const send = buildSend();
    const outcome = await processSection(h.db, REF, buildEnv(send), {
      fetchClass: async () =>
        buildDetails({ seats_available: 0, non_reserved_seats: 0, instructor_name: 'Staff' }),
    });

    expect(outcome.disposition).toBe('ack');
    expect(outcome.result.success).toBe(true);
    expect(outcome.result.changes.seatsFilled).toBe(true);
    expect(outcome.result.emailsSent).toBe(0);
    expect(send).not.toHaveBeenCalled();
    expect(h.statements.some((s) => s.sql.includes('delete from "notifications_sent"'))).toBe(true);
  });

  it('emails only the claimed watcher IDs', async () => {
    const h = createScriptedPostgres();
    h.next([oldStateRow()]);
    h.next([]); // upsertClassState
    h.next([
      { user_id: 'user-1', email: 'alice@example.com', watch_id: 'watch-1' },
      { user_id: 'user-2', email: 'bob@example.com', watch_id: 'watch-2' },
    ]);
    h.next([{ recorded: '{watch-1}' }]); // watch-2 already notified within 24h

    const send = buildSend();
    const outcome = await processSection(h.db, REF, buildEnv(send), {
      fetchClass: async () => buildDetails({ instructor_name: 'Staff' }),
    });

    expect(outcome.disposition).toBe('ack');
    expect(outcome.result.emailsSent).toBe(1);
    expect(send).toHaveBeenCalledTimes(1);
    const firstSend = send.mock.calls[0][0] as { to: string };
    expect(firstSend.to).toBe('alice@example.com');
  });

  it('rolls back the claim when the send fails', async () => {
    const h = createScriptedPostgres();
    h.next([oldStateRow()]);
    h.next([]); // upsertClassState
    h.next([{ user_id: 'user-1', email: 'alice@example.com', watch_id: 'watch-1' }]);
    h.next([{ recorded: '{watch-1}' }]); // claim
    h.next([{ deleted: 1 }]); // delete_notification_records rollback

    const send = buildSend();
    send.mockRejectedValueOnce(new Error('SMTP 550 mailbox unavailable'));

    const outcome = await processSection(h.db, REF, buildEnv(send), {
      fetchClass: async () => buildDetails({ instructor_name: 'Staff' }),
    });

    expect(outcome.disposition).toBe('ack');
    expect(outcome.result.success).toBe(true);
    expect(outcome.result.emailsSent).toBe(0);
    expect(send).toHaveBeenCalledTimes(1);
    const rollbacks = h.statements.filter((s) => s.sql.includes('delete_notification_records'));
    expect(rollbacks).toHaveLength(1);
    expect(rollbacks[0].params).toContain('watch-1');
  });

  it('first NotFound tracks strike 1 with ack and deletes nothing', async () => {
    const h = createScriptedPostgres();
    h.next([oldStateRow()]);
    h.next([{ new_count: 1 }]); // increment_consecutive_not_found

    const send = buildSend();
    const outcome = await processSection(h.db, REF, buildEnv(send), {
      fetchClass: async () => {
        throw new NotFoundError('Section 42737 not found');
      },
    });

    expect(outcome.disposition).toBe('ack');
    expect(outcome.httpStatus).toBe(200);
    expect(outcome.retryable).toBe(false);
    expect(outcome.result.success).toBe(false);
    expect(outcome.result.error).toBe('Section 42737 not found');
    expect(outcome.result.retirement).toMatchObject({
      status: 'tracked',
      strikeCount: 1,
      deleted: false,
    });
    expect(send).not.toHaveBeenCalled();
    expect(h.statements.some((s) => s.sql.includes('delete from'))).toBe(false);
  });

  it('third consecutive NotFound retires the section with ack', async () => {
    const h = createScriptedPostgres();
    h.next([oldStateRow()]);
    h.next([{ new_count: 3 }]); // increment_consecutive_not_found at threshold
    h.next([{ value: 10 }]); // breaker total
    h.next([{ value: 1 }]); // breaker flagged
    h.next([{ user_id: 'user-1', email: 'alice@example.com', watch_id: 'watch-1' }]);
    h.next([{ subject: 'CSE', catalog_nbr: '110', title: 'Principles of Programming' }]);
    h.next([{ id: 'watch-1' }]); // deleted watches
    h.next([{ id: 'state-1' }]); // deleted state

    const send = buildSend();
    const outcome = await processSection(h.db, REF, buildEnv(send), {
      fetchClass: async () => {
        throw new NotFoundError('Section 42737 not found');
      },
    });

    expect(outcome.disposition).toBe('ack');
    expect(outcome.httpStatus).toBe(200);
    expect(outcome.result.success).toBe(true);
    expect(outcome.result.error).toContain('Auto-cleanup');
    expect(outcome.result.emailsSent).toBe(1);
    expect(outcome.result.retirement).toMatchObject({
      status: 'retired',
      strikeCount: 3,
      deleted: true,
      watchesDeleted: 1,
      emailsSucceeded: 1,
    });
    expect(send).toHaveBeenCalledTimes(1);
    const firstSend = send.mock.calls[0][0] as { to: string };
    expect(firstSend.to).toBe('alice@example.com');
  });

  it('rate-limit error retries with 429', async () => {
    const h = createScriptedPostgres();
    h.next([oldStateRow()]);

    const send = buildSend();
    const outcome = await processSection(h.db, REF, buildEnv(send), {
      fetchClass: async () => {
        throw new RateLimitError('ASU API rate limit hit');
      },
    });

    expect(outcome.disposition).toBe('retry');
    expect(outcome.httpStatus).toBe(429);
    expect(outcome.retryable).toBe(true);
    expect(outcome.result.error).toBe('ASU API rate limit hit');
    expect(send).not.toHaveBeenCalled();
  });

  it('upstream ApiError retries with 502', async () => {
    const h = createScriptedPostgres();
    h.next([oldStateRow()]);

    const send = buildSend();
    const outcome = await processSection(h.db, REF, buildEnv(send), {
      fetchClass: async () => {
        throw new ApiError('ASU API 502 Bad Gateway', 502);
      },
    });

    expect(outcome.disposition).toBe('retry');
    expect(outcome.httpStatus).toBe(502);
    expect(outcome.retryable).toBe(true);
    expect(send).not.toHaveBeenCalled();
  });

  it('unknown error retries with 500', async () => {
    const h = createScriptedPostgres();
    h.next([oldStateRow()]);

    const send = buildSend();
    const outcome = await processSection(h.db, REF, buildEnv(send), {
      fetchClass: async () => {
        throw new Error('Unexpected internal error');
      },
    });

    expect(outcome.disposition).toBe('retry');
    expect(outcome.httpStatus).toBe(500);
    expect(outcome.retryable).toBe(true);
    expect(send).not.toHaveBeenCalled();
  });

  it('auth failure acks without retry and performs no retirement work', async () => {
    const h = createScriptedPostgres();
    h.next([oldStateRow()]);

    const send = buildSend();
    const outcome = await processSection(h.db, REF, buildEnv(send), {
      fetchClass: async () => {
        throw new AuthError('ASU API token expired or invalid');
      },
    });

    expect(outcome.disposition).toBe('ack');
    expect(outcome.httpStatus).toBe(200);
    expect(outcome.retryable).toBe(false);
    expect(outcome.result.success).toBe(false);
    expect(outcome.result.retirement).toBeUndefined();
    expect(send).not.toHaveBeenCalled();
    expect(h.statements).toHaveLength(1);
  });
});
