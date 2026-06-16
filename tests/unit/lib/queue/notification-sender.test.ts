import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';

// Mock Supabase service
vi.mock('@/lib/supabase/service', () => ({
  getServiceClient: vi.fn(),
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

import { deleteNotificationRecords, tryRecordNotificationsBatch } from '@/lib/db/queries';
import type { ClassInfo } from '@/lib/email/send';
import { sendBatchEmailsOptimized } from '@/lib/email/send';
import type { ChangeResult } from '@/lib/queue/change-detector';
import { sendSectionNotifications } from '@/lib/queue/notification-sender';
import { getServiceClient } from '@/lib/supabase/service';

function mockRpc(data: unknown[] | null, error: { message: string } | null = null) {
  const rpcMock = vi.fn().mockResolvedValue({ data, error });
  (getServiceClient as ReturnType<typeof vi.fn>).mockReturnValue({ rpc: rpcMock });
  return rpcMock;
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
    // Note: log(scope).info → console.info; log(scope).warn → console.warn; log(scope).error → console.error

    // Fresh email binding per test
    emailBinding = {
      send: vi.fn().mockResolvedValue({ messageId: 'msg_ok' }),
    } as unknown as SendEmail;

    // Default mock: watchers returned, claimed, email succeeds
    mockRpc(mockWatchers);
    (tryRecordNotificationsBatch as ReturnType<typeof vi.fn>).mockReset();
    (tryRecordNotificationsBatch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Set(['w1', 'w2'])
    );
    (sendBatchEmailsOptimized as ReturnType<typeof vi.fn>).mockReset();
    (sendBatchEmailsOptimized as ReturnType<typeof vi.fn>).mockResolvedValue([
      { success: true, messageId: 'msg_1' },
      { success: true, messageId: 'msg_2' },
    ]);
    (deleteNotificationRecords as ReturnType<typeof vi.fn>).mockReset();
    (deleteNotificationRecords as ReturnType<typeof vi.fn>).mockResolvedValue(1);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function defaultParams(): Parameters<typeof sendSectionNotifications>[0] {
    return {
      classNbr: '42737',
      classInfo: buildClassInfo(),
      changes: buildChanges({ seatBecameAvailable: true }),
      emailBinding,
      fromEmail: 'notifications@pickmyclass.app',
    };
  }

  it('throws when fetch watchers rpc errors', async () => {
    const rpcMock = mockRpc(null, { message: 'DB error' });

    await expect(sendSectionNotifications(defaultParams())).rejects.toThrow(
      'Failed to fetch watchers for 42737: DB error'
    );
    expect(rpcMock).toHaveBeenCalledWith('get_watchers_for_sections', {
      section_numbers: ['42737'],
    });
  });

  it('returns empty array when no watchers found', async () => {
    mockRpc([]);

    const result = await sendSectionNotifications(defaultParams());

    expect(result).toEqual([]);
    expect(console.info).toHaveBeenCalledWith(
      '[NotificationSender]',
      'No watchers found for 42737'
    );
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
    // Each claim returns different subsets
    (tryRecordNotificationsBatch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(new Set(['w1'])) // seat_available claims w1
      .mockResolvedValueOnce(new Set(['w2'])); // instructor_assigned claims w2

    const result = await sendSectionNotifications(params);

    // Two emails: w1 for seat, w2 for instructor
    expect(sendBatchEmailsOptimized).toHaveBeenCalledTimes(1);
    const emailArg = (sendBatchEmailsOptimized as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(emailArg).toHaveLength(2);
    expect(emailArg[0]).toMatchObject({ watchId: 'w1', type: 'seat_available' });
    expect(emailArg[1]).toMatchObject({ watchId: 'w2', type: 'instructor_assigned' });
    expect(result).toHaveLength(2);
  });

  it('returns empty array when no slots claimed', async () => {
    (tryRecordNotificationsBatch as ReturnType<typeof vi.fn>).mockResolvedValue(new Set());

    const result = await sendSectionNotifications(defaultParams());

    expect(result).toEqual([]);
    expect(sendBatchEmailsOptimized).not.toHaveBeenCalled();
  });

  it('does not delete or retry when first claim returns empty (non-destructive)', async () => {
    (tryRecordNotificationsBatch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(new Set());

    const result = await sendSectionNotifications(defaultParams());

    // "0 claimed" means everyone is already notified — no destructive cleanup, no retry.
    expect(deleteNotificationRecords).not.toHaveBeenCalled();
    expect(tryRecordNotificationsBatch).toHaveBeenCalledTimes(1);
    expect(sendBatchEmailsOptimized).not.toHaveBeenCalled();
    expect(result).toEqual([]);
  });

  it('rolls back notification records when email sending fails', async () => {
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

  it('records engagement for successful sends', async () => {
    await sendSectionNotifications(defaultParams());

    const rpcMock = (getServiceClient() as unknown as { rpc: ReturnType<typeof vi.fn> }).rpc;
    // Should call record_engagement_send_batch once with all unique successful user IDs
    expect(rpcMock).toHaveBeenCalledWith('record_engagement_send_batch', {
      p_user_ids: ['u1', 'u2'],
    });
    // Single batch call, not one per user
    expect(
      rpcMock.mock.calls.filter((c: unknown[]) => c[0] === 'record_engagement_send_batch')
    ).toHaveLength(1);
  });

  it('handles engagement recording failure gracefully', async () => {
    const rpcMock = mockRpc(mockWatchers);
    // Make the batch engagement call fail with error response
    rpcMock
      .mockResolvedValueOnce({ data: mockWatchers, error: null }) // get_watchers_for_sections
      .mockResolvedValueOnce({ data: null, error: { message: 'Engagement error' } }); // record_engagement_send_batch

    await expect(sendSectionNotifications(defaultParams())).resolves.not.toThrow();
    expect(console.warn).toHaveBeenCalled();
  });

  it('uses fromEmail when provided', async () => {
    await sendSectionNotifications(defaultParams());

    expect(sendBatchEmailsOptimized).toHaveBeenCalledWith(expect.any(Array), emailBinding, {
      fromEmail: 'notifications@pickmyclass.app',
    });
  });

  it('calls sendBatchEmailsOptimized with correct email payloads', async () => {
    await sendSectionNotifications(defaultParams());

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
      // First (and only) claim attempt returns all watchers.
      (tryRecordNotificationsBatch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        new Set(['w1', 'w2'])
      );

      const result = await sendSectionNotifications(defaultParams());

      // No stale-cleanup path taken when the first claim succeeds.
      expect(deleteNotificationRecords).not.toHaveBeenCalled();
      expect(tryRecordNotificationsBatch).toHaveBeenCalledTimes(1);

      // Emails sent to exactly the claimed watchers.
      const [emails] = (sendBatchEmailsOptimized as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(emails.map((e: { watchId: string }) => e.watchId)).toEqual(['w1', 'w2']);
      expect(result.map((r) => r.watchId)).toEqual(['w1', 'w2']);
    });

    it('first claim empty → no destructive delete, no re-claim, no re-send', async () => {
      // Fixed behavior: "0 claimed" means everyone is already (recently) notified.
      // We must NOT delete records and re-claim, which would re-email everyone.
      (tryRecordNotificationsBatch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(new Set());

      const result = await sendSectionNotifications(defaultParams());

      // No delete, single claim attempt, nobody re-emailed.
      expect(deleteNotificationRecords).not.toHaveBeenCalled();
      expect(tryRecordNotificationsBatch).toHaveBeenCalledTimes(1);
      expect(sendBatchEmailsOptimized).not.toHaveBeenCalled();
      expect(result).toEqual([]);
    });
  });
});
