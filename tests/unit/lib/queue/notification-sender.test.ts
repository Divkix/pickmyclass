import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';

// Mock DB client (replaces Supabase service mock)
vi.mock('@/lib/db/client', () => ({
  callFunction: vi.fn(),
  callFunctionScalar: vi.fn(),
  query: vi.fn(),
  queryOne: vi.fn(),
  queryScalar: vi.fn(),
  execute: vi.fn(),
  getClient: vi.fn(),
}));

// Mock DB queries
vi.mock('@/lib/db/queries', () => ({
  deleteNotificationRecords: vi.fn(),
  tryRecordNotificationsBatch: vi.fn(),
}));

// Mock email sender
vi.mock('@/lib/email/send', () => ({
  sendBatchEmailsOptimized: vi.fn(),
}));

import { callFunction } from '@/lib/db/client';
import { deleteNotificationRecords, tryRecordNotificationsBatch } from '@/lib/db/queries';
import type { ClassInfo } from '@/lib/email/send';
import { sendBatchEmailsOptimized } from '@/lib/email/send';
import type { ChangeResult } from '@/lib/queue/change-detector';
import { sendSectionNotifications } from '@/lib/queue/notification-sender';

function mockWatchersFetch(watchers: unknown[] | null) {
  // SAFETY: test double constructs minimal shape for DB client contract; only callFunction is accessed
  // eslint-disable-next-line anti-slop/no-known-value-widening -- SAFETY: test double narrows vi.fn mock type
  (callFunction as ReturnType<typeof vi.fn>).mockResolvedValue(watchers ?? []);
}

function mockWatchersFetchError(message: string) {
  // eslint-disable-next-line anti-slop/no-known-value-widening -- SAFETY: test double narrows vi.fn mock type
  (callFunction as ReturnType<typeof vi.fn>).mockRejectedValue(new Error(message));
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

const mockWatchers = [
  { user_id: 'u1', email: 'alice@test.com', watch_id: 'w1', class_nbr: '42737' },
  { user_id: 'u2', email: 'bob@test.com', watch_id: 'w2', class_nbr: '42737' },
];

describe('sendSectionNotifications', () => {
  let emailBinding: SendEmail;

  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});

    // SAFETY: test double constructs minimal shape for SDK contract; only accessed fields are asserted
    emailBinding = {
      send: vi.fn().mockResolvedValue({ messageId: 'msg_ok' }),
    } as SendEmail;

    // Default mock: watchers returned, claimed, email succeeds
    // eslint-disable-next-line anti-slop/no-known-value-widening -- SAFETY: test double narrows vi.fn mock type
    (callFunction as ReturnType<typeof vi.fn>).mockClear();
    mockWatchersFetch(mockWatchers);
    // SAFETY: test double constructs minimal shape for SDK contract; only accessed fields are asserted
    // eslint-disable-next-line anti-slop/no-known-value-widening -- SAFETY: test double narrows vi.fn mock type
    (tryRecordNotificationsBatch as ReturnType<typeof vi.fn>).mockReset();
    // eslint-disable-next-line anti-slop/no-known-value-widening -- SAFETY: test double narrows vi.fn mock type
    (tryRecordNotificationsBatch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Set(['w1', 'w2'])
    );
    // eslint-disable-next-line anti-slop/no-known-value-widening -- SAFETY: test double narrows vi.fn mock type
    (sendBatchEmailsOptimized as ReturnType<typeof vi.fn>).mockReset();
    // eslint-disable-next-line anti-slop/no-known-value-widening -- SAFETY: test double narrows vi.fn mock type
    (sendBatchEmailsOptimized as ReturnType<typeof vi.fn>).mockResolvedValue([
      { success: true, messageId: 'msg_1' },
      { success: true, messageId: 'msg_2' },
    ]);
    // eslint-disable-next-line anti-slop/no-known-value-widening -- SAFETY: test double narrows vi.fn mock type
    (deleteNotificationRecords as ReturnType<typeof vi.fn>).mockReset();
    // eslint-disable-next-line anti-slop/no-known-value-widening -- SAFETY: test double narrows vi.fn mock type
    (deleteNotificationRecords as ReturnType<typeof vi.fn>).mockResolvedValue(1);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function defaultParams(): Parameters<typeof sendSectionNotifications>[0] {
    return {
      ref: { class_nbr: '42737', term: '2261' },
      classInfo: buildClassInfo(),
      changes: buildChanges({ seatBecameAvailable: true }),
      emailBinding,
      fromEmail: 'notifications@pickmyclass.app',
    };
  }

  it('throws when fetch watchers errors', async () => {
    mockWatchersFetchError('DB error');

    await expect(sendSectionNotifications(defaultParams())).rejects.toThrow(
      'Failed to fetch watchers for 2261:42737: DB error'
    );
    expect(callFunction).toHaveBeenCalledWith('get_watchers_for_sections', [['42737'], '2261']);
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

    expect(callFunction).toHaveBeenCalledWith('get_watchers_for_sections', [['42737'], '2267']);
  });

  it('claims slots and sends emails for seat_available changes', async () => {
    const result = await sendSectionNotifications(defaultParams());

    expect(tryRecordNotificationsBatch).toHaveBeenCalledWith(['w1', 'w2'], 'seat_available');
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

    expect(tryRecordNotificationsBatch).toHaveBeenCalledWith(['w1', 'w2'], 'instructor_assigned');
    expect(sendBatchEmailsOptimized).toHaveBeenCalledTimes(1);
    expect(result).toHaveLength(2);
    expect(result[0].type).toBe('instructor_assigned');
  });

  it('handles both change types simultaneously', async () => {
    const params = {
      ...defaultParams(),
      changes: buildChanges({ seatBecameAvailable: true, instructorAssigned: true }),
    };
    // eslint-disable-next-line anti-slop/no-known-value-widening -- SAFETY: test double narrows vi.fn mock type
    (tryRecordNotificationsBatch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(new Set(['w1']))
      .mockResolvedValueOnce(new Set(['w2']));

    const result = await sendSectionNotifications(params);

    expect(sendBatchEmailsOptimized).toHaveBeenCalledTimes(1);
    // eslint-disable-next-line anti-slop/no-known-value-widening -- SAFETY: test double narrows vi.fn mock type
    const emailArg = (sendBatchEmailsOptimized as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(emailArg).toHaveLength(2);
    expect(emailArg[0]).toMatchObject({ watchId: 'w1', type: 'seat_available' });
    expect(emailArg[1]).toMatchObject({ watchId: 'w2', type: 'instructor_assigned' });
    expect(result).toHaveLength(2);
  });

  it('returns empty array when no slots claimed', async () => {
    // eslint-disable-next-line anti-slop/no-known-value-widening -- SAFETY: test double narrows vi.fn mock type
    (tryRecordNotificationsBatch as ReturnType<typeof vi.fn>).mockResolvedValue(new Set());

    const result = await sendSectionNotifications(defaultParams());

    expect(result).toEqual([]);
    expect(sendBatchEmailsOptimized).not.toHaveBeenCalled();
  });

  it('does not delete or retry when first claim returns empty (non-destructive)', async () => {
    // eslint-disable-next-line anti-slop/no-known-value-widening -- SAFETY: test double narrows vi.fn mock type
    (tryRecordNotificationsBatch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(new Set());

    const result = await sendSectionNotifications(defaultParams());

    expect(deleteNotificationRecords).not.toHaveBeenCalled();
    expect(tryRecordNotificationsBatch).toHaveBeenCalledTimes(1);
    expect(sendBatchEmailsOptimized).not.toHaveBeenCalled();
    expect(result).toEqual([]);
  });

  it('rolls back notification records when email sending fails', async () => {
    // eslint-disable-next-line anti-slop/no-known-value-widening -- SAFETY: test double narrows vi.fn mock type
    (sendBatchEmailsOptimized as ReturnType<typeof vi.fn>).mockResolvedValue([
      { success: true, messageId: 'msg_1' },
      { success: false, error: 'Send failed' },
    ]);

    const result = await sendSectionNotifications(defaultParams());

    expect(deleteNotificationRecords).toHaveBeenCalledWith(['w2'], 'seat_available');
    expect(result).toHaveLength(2);
    expect(result[0].success).toBe(true);
    expect(result[1].success).toBe(false);
    expect(result[1].error).toBe('Send failed');
  });

  it('does not infer email engagement from successful delivery', async () => {
    await sendSectionNotifications(defaultParams());

    // callFunction should only be called once (for get_watchers_for_sections), not for engagement tracking
    expect(callFunction).toHaveBeenCalledTimes(1);
    expect(callFunction).toHaveBeenCalledWith('get_watchers_for_sections', [['42737'], '2261']);
  });

  it('uses fromEmail when provided', async () => {
    await sendSectionNotifications(defaultParams());

    expect(sendBatchEmailsOptimized).toHaveBeenCalledWith(expect.any(Array), emailBinding, {
      fromEmail: 'notifications@pickmyclass.app',
    });
  });

  it('calls sendBatchEmailsOptimized with correct email payloads', async () => {
    await sendSectionNotifications(defaultParams());

    // eslint-disable-next-line anti-slop/no-known-value-widening -- SAFETY: test double narrows vi.fn mock type
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

  describe('claimSlots behavior', () => {
    it('happy path: first claim non-empty → no stale cleanup, emails only to claimed watchers', async () => {
      // eslint-disable-next-line anti-slop/no-known-value-widening -- SAFETY: test double narrows vi.fn mock type
      (tryRecordNotificationsBatch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        new Set(['w1', 'w2'])
      );

      const result = await sendSectionNotifications(defaultParams());

      expect(deleteNotificationRecords).not.toHaveBeenCalled();
      expect(tryRecordNotificationsBatch).toHaveBeenCalledTimes(1);

      // eslint-disable-next-line anti-slop/no-known-value-widening -- SAFETY: test double narrows vi.fn mock type
      const [emails] = (sendBatchEmailsOptimized as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(emails.map((e: { watchId: string }) => e.watchId)).toEqual(['w1', 'w2']);
      expect(result.map((r) => r.watchId)).toEqual(['w1', 'w2']);
    });

    it('first claim empty → no destructive delete, no re-claim, no re-send', async () => {
      // eslint-disable-next-line anti-slop/no-known-value-widening -- SAFETY: test double narrows vi.fn mock type
      (tryRecordNotificationsBatch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(new Set());

      const result = await sendSectionNotifications(defaultParams());

      expect(deleteNotificationRecords).not.toHaveBeenCalled();
      expect(tryRecordNotificationsBatch).toHaveBeenCalledTimes(1);
      expect(sendBatchEmailsOptimized).not.toHaveBeenCalled();
      expect(result).toEqual([]);
    });
  });
});
