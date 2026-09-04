import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';

vi.mock('@/lib/db/queries', () => ({
  deleteNotificationRecords: vi.fn(),
  getNotificationWatchers: vi.fn(),
  tryRecordNotificationsBatch: vi.fn(),
}));

vi.mock('@/lib/email/send', () => ({
  sendBatchEmailsOptimized: vi.fn(),
}));

import type { Database } from '@/lib/db';
import {
  deleteNotificationRecords,
  getNotificationWatchers,
  tryRecordNotificationsBatch,
  type EligibleWatcherRpcRow,
} from '@/lib/db/queries';
import type { ClassInfo } from '@/lib/email/send';
import { sendBatchEmailsOptimized } from '@/lib/email/send';
import type { ChangeResult } from '@/lib/queue/change-detector';
import { sendSectionNotifications } from '@/lib/queue/notification-sender';

const db = {} as Database;

function mockWatchersFetch(watchers: EligibleWatcherRpcRow[]) {
  vi.mocked(getNotificationWatchers).mockResolvedValue(watchers);
}

function mockWatchersFetchError(message: string) {
  vi.mocked(getNotificationWatchers).mockRejectedValue(new Error(message));
}

function buildClassInfo(overrides: Partial<ClassInfo> = {}): ClassInfo {
  return {
    class_nbr: '42737',
    subject: 'CSE',
    catalog_nbr: '110',
    title: 'Principles of Programming',
    term: '2261',
    instructor_name: 'Dr. Smith',
    seats_available: 3,
    seats_capacity: 100,
    location: 'BYAC 110',
    meeting_times: 'MWF 10:00-10:50',
    ...overrides,
  };
}

function buildChanges(overrides: Partial<ChangeResult> = {}): ChangeResult {
  return {
    seatBecameAvailable: false,
    seatsFilled: false,
    instructorAssigned: false,
    newOpenSeats: 0,
    ...overrides,
  };
}

const mockWatchers: EligibleWatcherRpcRow[] = [
  { user_id: 'u1', email: 'alice@test.com', watch_id: 'w1' },
  { user_id: 'u2', email: 'bob@test.com', watch_id: 'w2' },
];

describe('sendSectionNotifications', () => {
  let emailBinding: SendEmail;

  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});

    emailBinding = {
      send: vi.fn().mockResolvedValue({ messageId: 'msg_ok' }),
    } as SendEmail;

    vi.mocked(getNotificationWatchers).mockClear();
    mockWatchersFetch(mockWatchers);
    // eslint-disable-next-line anti-slop/no-known-value-widening
    (tryRecordNotificationsBatch as ReturnType<typeof vi.fn>).mockReset();
    // eslint-disable-next-line anti-slop/no-known-value-widening
    (tryRecordNotificationsBatch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Set(['w1', 'w2'])
    );
    // eslint-disable-next-line anti-slop/no-known-value-widening
    (sendBatchEmailsOptimized as ReturnType<typeof vi.fn>).mockReset();
    // eslint-disable-next-line anti-slop/no-known-value-widening
    (sendBatchEmailsOptimized as ReturnType<typeof vi.fn>).mockResolvedValue([
      { success: true, messageId: 'msg_1' },
      { success: true, messageId: 'msg_2' },
    ]);
    // eslint-disable-next-line anti-slop/no-known-value-widening
    (deleteNotificationRecords as ReturnType<typeof vi.fn>).mockReset();
    // eslint-disable-next-line anti-slop/no-known-value-widening
    (deleteNotificationRecords as ReturnType<typeof vi.fn>).mockResolvedValue(1);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function defaultParams(): Parameters<typeof sendSectionNotifications>[0] {
    return {
      db,
      ref: { class_nbr: '42737', term: '2261' },
      classInfo: buildClassInfo(),
      changes: buildChanges({ seatBecameAvailable: true }),
      emailBinding,
      fromEmail: 'notifications@pickmyclass.app',
    };
  }

  it('throws when fetch watchers errors', async () => {
    mockWatchersFetchError('DB error');

    await expect(sendSectionNotifications(defaultParams())).rejects.toThrow('DB error');

    expect(getNotificationWatchers).toHaveBeenCalledWith(db, { class_nbr: '42737', term: '2261' });
    expect(tryRecordNotificationsBatch).not.toHaveBeenCalled();
    expect(deleteNotificationRecords).not.toHaveBeenCalled();
    expect(sendBatchEmailsOptimized).not.toHaveBeenCalled();
  });

  it('returns empty array when no watchers found', async () => {
    mockWatchersFetch([]);

    const result = await sendSectionNotifications(defaultParams());

    expect(result).toEqual([]);
    expect(console.info).toHaveBeenCalledWith(
      '[NotificationSender]',
      'No watchers found for 2261:42737'
    );
  });

  it('scopes the watcher lookup to the full SectionRef (class_nbr + term)', async () => {
    mockWatchersFetch(mockWatchers);

    await sendSectionNotifications({
      ...defaultParams(),
      ref: { class_nbr: '42737', term: '2267' },
    });

    expect(getNotificationWatchers).toHaveBeenCalledWith(db, { class_nbr: '42737', term: '2267' });
  });

  it('claims slots and sends emails for seat_available changes', async () => {
    const result = await sendSectionNotifications(defaultParams());

    expect(tryRecordNotificationsBatch).toHaveBeenCalledWith(db, ['w1', 'w2'], 'seat_available');
    expect(sendBatchEmailsOptimized).toHaveBeenCalledTimes(1);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      success: true,
      watchId: 'w1',
      type: 'seat_available',
      error: undefined,
    });
    expect(result[1]).toEqual({
      success: true,
      watchId: 'w2',
      type: 'seat_available',
      error: undefined,
    });
  });

  it('claims slots and sends emails for instructor_assigned changes', async () => {
    const params = { ...defaultParams(), changes: buildChanges({ instructorAssigned: true }) };

    const result = await sendSectionNotifications(params);

    expect(tryRecordNotificationsBatch).toHaveBeenCalledWith(
      db,
      ['w1', 'w2'],
      'instructor_assigned'
    );
    expect(sendBatchEmailsOptimized).toHaveBeenCalledTimes(1);
    expect(result).toHaveLength(2);
    expect(result[0].type).toBe('instructor_assigned');
  });

  it('handles both change types simultaneously', async () => {
    const params = {
      ...defaultParams(),
      changes: buildChanges({ seatBecameAvailable: true, instructorAssigned: true }),
    };
    // eslint-disable-next-line anti-slop/no-known-value-widening
    (tryRecordNotificationsBatch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(new Set(['w1']))
      .mockResolvedValueOnce(new Set(['w2']));

    const result = await sendSectionNotifications(params);

    expect(sendBatchEmailsOptimized).toHaveBeenCalledTimes(1);
    // eslint-disable-next-line anti-slop/no-known-value-widening
    const emailArg = (sendBatchEmailsOptimized as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(emailArg).toHaveLength(2);
    expect(emailArg[0]).toMatchObject({ watchId: 'w1', type: 'seat_available' });
    expect(emailArg[1]).toMatchObject({ watchId: 'w2', type: 'instructor_assigned' });
    expect(result).toHaveLength(2);
  });

  it('returns empty array when no slots claimed', async () => {
    // eslint-disable-next-line anti-slop/no-known-value-widening
    (tryRecordNotificationsBatch as ReturnType<typeof vi.fn>).mockResolvedValue(new Set());

    const result = await sendSectionNotifications(defaultParams());

    expect(result).toEqual([]);
    expect(sendBatchEmailsOptimized).not.toHaveBeenCalled();
  });

  it('does not delete or retry when first claim returns empty (non-destructive)', async () => {
    // eslint-disable-next-line anti-slop/no-known-value-widening
    (tryRecordNotificationsBatch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(new Set());

    const result = await sendSectionNotifications(defaultParams());

    expect(deleteNotificationRecords).not.toHaveBeenCalled();
    expect(tryRecordNotificationsBatch).toHaveBeenCalledTimes(1);
    expect(sendBatchEmailsOptimized).not.toHaveBeenCalled();
    expect(result).toEqual([]);
  });

  it('rolls back notification records when email sending fails', async () => {
    // eslint-disable-next-line anti-slop/no-known-value-widening
    (sendBatchEmailsOptimized as ReturnType<typeof vi.fn>).mockResolvedValue([
      { success: true, messageId: 'msg_1' },
      { success: false, error: 'Send failed' },
    ]);

    const result = await sendSectionNotifications(defaultParams());

    expect(deleteNotificationRecords).toHaveBeenCalledWith(db, ['w2'], 'seat_available');
    expect(result).toHaveLength(2);
    expect(result[0].success).toBe(true);
    expect(result[1].success).toBe(false);
    expect(result[1].error).toBe('Send failed');
  });

  it('rolls back the fulfilled claim when its sibling claim rejects', async () => {
    vi.mocked(tryRecordNotificationsBatch)
      .mockResolvedValueOnce(new Set(['w1']))
      .mockRejectedValueOnce(new Error('claim boom'));

    await expect(
      sendSectionNotifications({
        ...defaultParams(),
        changes: buildChanges({ seatBecameAvailable: true, instructorAssigned: true }),
      })
    ).rejects.toThrow('claim boom');

    expect(deleteNotificationRecords).toHaveBeenCalledTimes(1);
    expect(deleteNotificationRecords).toHaveBeenCalledWith(db, ['w1'], 'seat_available');
    expect(sendBatchEmailsOptimized).not.toHaveBeenCalled();
  });

  it('propagates the first rejection and rolls back the later fulfilled claim', async () => {
    vi.mocked(tryRecordNotificationsBatch)
      .mockRejectedValueOnce(new Error('seat claim failed'))
      .mockResolvedValueOnce(new Set(['w2']));

    await expect(
      sendSectionNotifications({
        ...defaultParams(),
        changes: buildChanges({ seatBecameAvailable: true, instructorAssigned: true }),
      })
    ).rejects.toThrow('seat claim failed');

    expect(deleteNotificationRecords).toHaveBeenCalledTimes(1);
    expect(deleteNotificationRecords).toHaveBeenCalledWith(db, ['w2'], 'instructor_assigned');
    expect(sendBatchEmailsOptimized).not.toHaveBeenCalled();
  });

  it('fails open when the send-failure rollback itself errors', async () => {
    vi.mocked(sendBatchEmailsOptimized).mockResolvedValue([
      { success: true, messageId: 'msg_1' },
      { success: false, error: 'Send failed' },
    ]);
    vi.mocked(deleteNotificationRecords).mockRejectedValue(new Error('rollback down'));

    const result = await sendSectionNotifications(defaultParams());

    expect(deleteNotificationRecords).toHaveBeenCalledWith(db, ['w2'], 'seat_available');
    expect(result).toHaveLength(2);
    expect(result[0].success).toBe(true);
    expect(result[1]).toEqual({
      success: false,
      watchId: 'w2',
      type: 'seat_available',
      error: 'Send failed',
    });
  });

  it('does not infer email engagement from successful delivery', async () => {
    await sendSectionNotifications(defaultParams());

    expect(getNotificationWatchers).toHaveBeenCalledTimes(1);
    expect(getNotificationWatchers).toHaveBeenCalledWith(db, { class_nbr: '42737', term: '2261' });
    expect(tryRecordNotificationsBatch).toHaveBeenCalledTimes(1);
  });

  it('uses fromEmail when provided', async () => {
    await sendSectionNotifications(defaultParams());

    expect(sendBatchEmailsOptimized).toHaveBeenCalledWith(expect.any(Array), emailBinding, {
      fromEmail: 'notifications@pickmyclass.app',
    });
  });

  it('calls sendBatchEmailsOptimized with correct email payloads', async () => {
    await sendSectionNotifications(defaultParams());

    // eslint-disable-next-line anti-slop/no-known-value-widening
    const [emails] = (sendBatchEmailsOptimized as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(emails).toHaveLength(2);
    expect(emails[0]).toMatchObject({
      to: 'alice@test.com',
      userId: 'u1',
      watchId: 'w1',
      type: 'seat_available',
    });
    expect(emails[1]).toMatchObject({
      to: 'bob@test.com',
      userId: 'u2',
      watchId: 'w2',
      type: 'seat_available',
    });
  });

  it('does not claim slots for change types that are false', async () => {
    const params = {
      ...defaultParams(),
      changes: buildChanges({ seatBecameAvailable: false, instructorAssigned: false }),
    };

    const result = await sendSectionNotifications(params);

    expect(tryRecordNotificationsBatch).not.toHaveBeenCalled();
    expect(sendBatchEmailsOptimized).not.toHaveBeenCalled();
    expect(result).toEqual([]);
  });

  describe('claim behavior', () => {
    it('happy path: first claim non-empty → no stale cleanup, emails only to claimed watchers', async () => {
      // eslint-disable-next-line anti-slop/no-known-value-widening
      (tryRecordNotificationsBatch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        new Set(['w1', 'w2'])
      );

      const result = await sendSectionNotifications(defaultParams());

      expect(deleteNotificationRecords).not.toHaveBeenCalled();
      expect(tryRecordNotificationsBatch).toHaveBeenCalledTimes(1);

      // eslint-disable-next-line anti-slop/no-known-value-widening
      const [emails] = (sendBatchEmailsOptimized as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(emails.map((e: { watchId: string }) => e.watchId)).toEqual(['w1', 'w2']);
      expect(result.map((r) => r.watchId)).toEqual(['w1', 'w2']);
    });

    it('first claim empty → no destructive delete, no re-claim, no re-send', async () => {
      // eslint-disable-next-line anti-slop/no-known-value-widening
      (tryRecordNotificationsBatch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(new Set());

      const result = await sendSectionNotifications(defaultParams());

      expect(deleteNotificationRecords).not.toHaveBeenCalled();
      expect(tryRecordNotificationsBatch).toHaveBeenCalledTimes(1);
      expect(sendBatchEmailsOptimized).not.toHaveBeenCalled();
      expect(result).toEqual([]);
    });
  });
});
