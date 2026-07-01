import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import type { ValidationIssueDetail } from '@/lib/api/validation';

// Mock Cloudflare Workers env - must use factory function for hoisting
vi.mock('cloudflare:workers', () => ({
  env: { CRON_SECRET: 'test-cron-secret' },
}));

import { POST } from '@/app/api/queue/process-section/route';

function createRequest(body: string, authHeader?: string): NextRequest {
  return new NextRequest('http://localhost:3000/api/queue/process-section', {
    method: 'POST',
    body,
    headers: {
      'Content-Type': 'application/json',
      ...(authHeader ? { Authorization: authHeader } : {}),
    },
  });
}

// Mock Supabase service client
const mockFrom = vi.fn();
const mockRpc = vi.fn();

vi.mock('@/lib/supabase/service', () => ({
  getServiceClient: vi.fn(() => ({
    from: mockFrom,
    rpc: mockRpc,
  })),
}));

// Mock ASU API client
const mockFetchClassFromASU = vi.fn();
vi.mock('@/lib/asu/api', () => ({
  fetchClassFromASU: (...args: unknown[]) => mockFetchClassFromASU(...args),
  NotFoundError: class NotFoundError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'NotFoundError';
    }
  },
  AuthError: class AuthError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'AuthError';
    }
  },
  ApiError: class ApiError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'ApiError';
    }
  },
  RateLimitError: class RateLimitError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'RateLimitError';
    }
  },
}));

// Mock email sending
const mockSendBatchEmailsOptimized = vi.fn();
vi.mock('@/lib/email/send', () => ({
  sendBatchEmailsOptimized: (...args: unknown[]) => mockSendBatchEmailsOptimized(...args),
}));

// Mock DB queries
const mockTryRecordNotificationsBatch = vi.fn();
const mockResetNotificationsForSection = vi.fn();
const mockDeleteNotificationRecords = vi.fn();

vi.mock('@/lib/db/queries', () => ({
  tryRecordNotificationsBatch: (...args: unknown[]) => mockTryRecordNotificationsBatch(...args),
  resetNotificationsForSection: (...args: unknown[]) => mockResetNotificationsForSection(...args),
  deleteNotificationRecords: (...args: unknown[]) => mockDeleteNotificationRecords(...args),
}));

describe('POST /api/queue/process-section', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: no existing state (simulates first observation)
    mockFrom.mockReturnValue({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: vi.fn().mockResolvedValue({ data: null, error: { code: 'PGRST116' } }),
          })),
        })),
      })),
      upsert: vi.fn().mockResolvedValue({ error: null }),
    });
    mockRpc.mockResolvedValue({ data: [], error: null });
    mockSendBatchEmailsOptimized.mockResolvedValue([]);
    mockTryRecordNotificationsBatch.mockResolvedValue(new Set());
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 for unauthorized requests', async () => {
    const response = await POST(
      createRequest(JSON.stringify({ class_nbr: '12345', term: '2261' }))
    );
    const data = (await response.json()) as { success: boolean; error: string };

    expect(response.status).toBe(401);
    expect(data.success).toBe(false);
    expect(data.error).toBe('Unauthorized');
  });

  it('returns non-retryable response for malformed JSON payloads', async () => {
    const response = await POST(createRequest('{"class_nbr":"12345"', 'Bearer test-cron-secret'));
    const data = (await response.json()) as {
      success: boolean;
      error: string;
      retryable: boolean;
    };

    expect(response.status).toBe(200);
    expect(data.success).toBe(false);
    expect(data.error).toBe('Invalid message payload');
    expect(data.retryable).toBe(false);
  });

  it('returns non-retryable response for invalid message shape', async () => {
    const response = await POST(
      createRequest(JSON.stringify({ class_nbr: '123', term: 'bad' }), 'Bearer test-cron-secret')
    );
    const data = (await response.json()) as {
      success: boolean;
      error: string;
      retryable: boolean;
      details: ValidationIssueDetail[];
    };

    expect(response.status).toBe(200);
    expect(data.success).toBe(false);
    expect(data.error).toBe('Invalid message payload');
    expect(data.retryable).toBe(false);
    expect(data.details).toBeDefined();
    expect(data.details.length).toBeGreaterThan(0);
  });

  describe('first-observation suppression (null oldState)', () => {
    it('suppresses seatBecameAvailable on first observation even when seats are available', async () => {
      // Mock ASU API to return class with open seats
      mockFetchClassFromASU.mockResolvedValue({
        subject: 'CSE',
        catalog_nbr: '110',
        title: 'Intro to Programming',
        instructor_name: 'Dr. Smith',
        seats_available: 5,
        seats_capacity: 30,
        non_reserved_seats: null,
        location: 'Online',
        meeting_times: 'MWF 9:00-9:50',
      });

      // Mock watcher exists
      mockRpc.mockResolvedValue({
        data: [{ user_id: 'user-1', email: 'test@example.com', watch_id: 'watch-1' }],
        error: null,
      });

      const response = await POST(
        createRequest(
          JSON.stringify({ class_nbr: '12345', term: '2261' }),
          'Bearer test-cron-secret'
        )
      );

      const data = (await response.json()) as {
        success: boolean;
        changes_detected: {
          seat_became_available: boolean;
          instructor_assigned: boolean;
        };
        emails_sent: number;
      };

      // First observation: no baseline, so no transition emails — just persist the baseline.
      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.changes_detected.seat_became_available).toBe(false);
      expect(data.changes_detected.instructor_assigned).toBe(false);
      expect(data.emails_sent).toBe(0);
      expect(mockTryRecordNotificationsBatch).not.toHaveBeenCalled();
    });

    it('suppresses instructorAssigned on first observation even when instructor is not Staff', async () => {
      // Mock ASU API to return class with assigned instructor (not Staff)
      mockFetchClassFromASU.mockResolvedValue({
        subject: 'CSE',
        catalog_nbr: '110',
        title: 'Intro to Programming',
        instructor_name: 'Dr. Johnson', // Not 'Staff'
        seats_available: 0, // No seats available
        seats_capacity: 30,
        non_reserved_seats: null,
        location: 'Online',
        meeting_times: 'MWF 9:00-9:50',
      });

      // Mock watcher exists
      mockRpc.mockResolvedValue({
        data: [{ user_id: 'user-1', email: 'test@example.com', watch_id: 'watch-1' }],
        error: null,
      });

      const response = await POST(
        createRequest(
          JSON.stringify({ class_nbr: '12345', term: '2261' }),
          'Bearer test-cron-secret'
        )
      );

      const data = (await response.json()) as {
        success: boolean;
        changes_detected: {
          seat_became_available: boolean;
          instructor_assigned: boolean;
        };
        emails_sent: number;
      };

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.changes_detected.seat_became_available).toBe(false);
      expect(data.changes_detected.instructor_assigned).toBe(false); // suppressed on first observation
      expect(data.emails_sent).toBe(0);
      expect(mockTryRecordNotificationsBatch).not.toHaveBeenCalled();
    });

    it('suppresses both changes on first observation even when both conditions are met', async () => {
      // Mock ASU API to return class with open seats and assigned instructor
      mockFetchClassFromASU.mockResolvedValue({
        subject: 'CSE',
        catalog_nbr: '110',
        title: 'Intro to Programming',
        instructor_name: 'Dr. Smith', // Not 'Staff'
        seats_available: 5,
        seats_capacity: 30,
        non_reserved_seats: null,
        location: 'Online',
        meeting_times: 'MWF 9:00-9:50',
      });

      // Mock watcher exists
      mockRpc.mockResolvedValue({
        data: [{ user_id: 'user-1', email: 'test@example.com', watch_id: 'watch-1' }],
        error: null,
      });

      const response = await POST(
        createRequest(
          JSON.stringify({ class_nbr: '12345', term: '2261' }),
          'Bearer test-cron-secret'
        )
      );

      const data = (await response.json()) as {
        success: boolean;
        changes_detected: {
          seat_became_available: boolean;
          instructor_assigned: boolean;
        };
        emails_sent: number;
      };

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.changes_detected.seat_became_available).toBe(false);
      expect(data.changes_detected.instructor_assigned).toBe(false);
      expect(data.emails_sent).toBe(0);
      expect(mockTryRecordNotificationsBatch).not.toHaveBeenCalled();
    });

    it('should not trigger notifications when seats are 0 and instructor is Staff with null oldState', async () => {
      // Mock ASU API to return class with no seats and Staff instructor
      mockFetchClassFromASU.mockResolvedValue({
        subject: 'CSE',
        catalog_nbr: '110',
        title: 'Intro to Programming',
        instructor_name: 'Staff',
        seats_available: 0,
        seats_capacity: 30,
        non_reserved_seats: null,
        location: 'Online',
        meeting_times: 'MWF 9:00-9:50',
      });

      const response = await POST(
        createRequest(
          JSON.stringify({ class_nbr: '12345', term: '2261' }),
          'Bearer test-cron-secret'
        )
      );

      const data = (await response.json()) as {
        success: boolean;
        changes_detected: {
          seat_became_available: boolean;
          instructor_assigned: boolean;
        };
        emails_sent: number;
      };

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.changes_detected.seat_became_available).toBe(false);
      expect(data.changes_detected.instructor_assigned).toBe(false);
      expect(data.emails_sent).toBe(0);
    });

    it('should reset notifications when seats are filled (seats 5 -> 0)', async () => {
      // Mock existing state: 5 seats available
      mockFrom.mockReturnValue({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({
                data: {
                  class_nbr: '12345',
                  term: '2261',
                  seats_available: 5,
                  instructor_name: 'Staff',
                },
                error: null,
              }),
            })),
          })),
        })),
        upsert: vi.fn().mockResolvedValue({ error: null }),
      });

      // Mock ASU API: 0 seats available
      mockFetchClassFromASU.mockResolvedValue({
        subject: 'CSE',
        catalog_nbr: '110',
        title: 'Intro to Programming',
        instructor_name: 'Staff',
        seats_available: 0,
        seats_capacity: 30,
        non_reserved_seats: null,
        location: 'Online',
        meeting_times: 'MWF 9:00-9:50',
      });

      const response = await POST(
        createRequest(
          JSON.stringify({ class_nbr: '12345', term: '2261' }),
          'Bearer test-cron-secret'
        )
      );

      const data = (await response.json()) as {
        success: boolean;
        changes_detected: {
          seats_filled: boolean;
        };
      };

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.changes_detected.seats_filled).toBe(true);
      expect(mockResetNotificationsForSection).toHaveBeenCalledWith(
        { class_nbr: '12345', term: '2261' },
        'seat_available'
      );
    });
  });

  describe('rollback failure handling (issue #158)', () => {
    it('should return 500 when deleteNotificationRecords fails for seat_available emails', async () => {
      // Existing baseline (0 seats, Dr. Smith) so a real seat transition fires (not first observation).
      mockFrom.mockReturnValue({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({
                data: {
                  class_nbr: '12345',
                  term: '2261',
                  seats_available: 0,
                  non_reserved_seats: 0,
                  instructor_name: 'Dr. Smith',
                },
                error: null,
              }),
            })),
          })),
        })),
        upsert: vi.fn().mockResolvedValue({ error: null }),
      });

      // Mock ASU API to return class with open seats
      mockFetchClassFromASU.mockResolvedValue({
        subject: 'CSE',
        catalog_nbr: '110',
        title: 'Intro to Programming',
        instructor_name: 'Dr. Smith',
        seats_available: 5,
        seats_capacity: 30,
        non_reserved_seats: null,
        location: 'Online',
        meeting_times: 'MWF 9:00-9:50',
      });

      // Mock watcher exists
      mockRpc.mockResolvedValue({
        data: [{ user_id: 'user-1', email: 'test@example.com', watch_id: 'watch-1' }],
        error: null,
      });

      // Mock notification recording to succeed
      mockTryRecordNotificationsBatch.mockResolvedValue(new Set(['watch-1']));

      // Mock email sending with partial failure (email fails)
      mockSendBatchEmailsOptimized.mockResolvedValue([
        { success: false, error: new Error('SMTP error') },
      ]);

      // Mock rollback to fail - this is the bug scenario
      mockDeleteNotificationRecords.mockRejectedValue(new Error('Database unavailable'));

      const response = await POST(
        createRequest(
          JSON.stringify({ class_nbr: '12345', term: '2261' }),
          'Bearer test-cron-secret'
        )
      );

      const data = (await response.json()) as {
        success: boolean;
        error: string;
      };

      // Should return 500 to allow queue retry, not 200
      expect(response.status).toBe(500);
      expect(data.success).toBe(false);
    });

    it('should return 500 when deleteNotificationRecords fails for instructor_assigned emails', async () => {
      // Existing baseline (0 seats, Staff) so a real instructor transition fires (not first observation).
      mockFrom.mockReturnValue({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({
                data: {
                  class_nbr: '12345',
                  term: '2261',
                  seats_available: 0,
                  non_reserved_seats: 0,
                  instructor_name: 'Staff',
                },
                error: null,
              }),
            })),
          })),
        })),
        upsert: vi.fn().mockResolvedValue({ error: null }),
      });

      // Mock ASU API to return class with assigned instructor
      mockFetchClassFromASU.mockResolvedValue({
        subject: 'CSE',
        catalog_nbr: '110',
        title: 'Intro to Programming',
        instructor_name: 'Dr. Smith', // Not 'Staff'
        seats_available: 0, // No seats available
        seats_capacity: 30,
        non_reserved_seats: null,
        location: 'Online',
        meeting_times: 'MWF 9:00-9:50',
      });

      // Mock watcher exists
      mockRpc.mockResolvedValue({
        data: [{ user_id: 'user-1', email: 'test@example.com', watch_id: 'watch-1' }],
        error: null,
      });

      // Mock notification recording to succeed
      mockTryRecordNotificationsBatch.mockResolvedValue(new Set(['watch-1']));

      // Mock email sending with partial failure
      mockSendBatchEmailsOptimized.mockResolvedValue([
        { success: false, error: new Error('SMTP error') },
      ]);

      // Mock rollback to fail
      mockDeleteNotificationRecords.mockRejectedValue(new Error('Database unavailable'));

      const response = await POST(
        createRequest(
          JSON.stringify({ class_nbr: '12345', term: '2261' }),
          'Bearer test-cron-secret'
        )
      );

      const data = (await response.json()) as {
        success: boolean;
        error: string;
      };

      // Should return 500 to allow queue retry, not 200
      expect(response.status).toBe(500);
      expect(data.success).toBe(false);
    });
  });

  describe('notification dedup claim (issue #193)', () => {
    // Existing baseline so genuine transitions fire (not a first observation).
    function mockBaseline(instructor_name: string) {
      mockFrom.mockReturnValue({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({
                data: {
                  class_nbr: '12345',
                  term: '2261',
                  seats_available: 0,
                  non_reserved_seats: 0,
                  instructor_name,
                },
                error: null,
              }),
            })),
          })),
        })),
        upsert: vi.fn().mockResolvedValue({ error: null }),
      });
    }

    it('should NOT run cleanup when tryRecordNotificationsBatch succeeds on first attempt', async () => {
      mockBaseline('Staff'); // baseline: 0 seats + Staff → both transitions fire

      // Mock ASU API to return class with open seats and assigned instructor
      mockFetchClassFromASU.mockResolvedValue({
        subject: 'CSE',
        catalog_nbr: '110',
        title: 'Intro to Programming',
        instructor_name: 'Dr. Smith',
        seats_available: 5,
        seats_capacity: 30,
        non_reserved_seats: null,
        location: 'Online',
        meeting_times: 'MWF 9:00-9:50',
      });

      // Mock watcher exists
      mockRpc.mockResolvedValue({
        data: [{ user_id: 'user-1', email: 'test@example.com', watch_id: 'watch-1' }],
        error: null,
      });

      // Mock notification recording to succeed (returns non-empty set)
      mockTryRecordNotificationsBatch
        .mockResolvedValueOnce(new Set(['watch-1'])) // seat_available succeeds
        .mockResolvedValueOnce(new Set(['watch-1'])); // instructor_assigned succeeds

      // Mock email sending
      mockSendBatchEmailsOptimized.mockResolvedValue([
        { success: true, id: 'email-1' },
        { success: true, id: 'email-2' },
      ]);

      await POST(
        createRequest(
          JSON.stringify({ class_nbr: '12345', term: '2261' }),
          'Bearer test-cron-secret'
        )
      );

      // Cleanup should NOT be called when tryRecordNotificationsBatch succeeds
      expect(mockDeleteNotificationRecords).not.toHaveBeenCalled();
    });

    it('does NOT delete or retry when tryRecordNotificationsBatch returns empty set (already notified)', async () => {
      mockBaseline('Staff'); // baseline: 0 seats + Staff → both transitions fire

      // Mock ASU API to return class with open seats + assigned instructor
      mockFetchClassFromASU.mockResolvedValue({
        subject: 'CSE',
        catalog_nbr: '110',
        title: 'Intro to Programming',
        instructor_name: 'Dr. Smith',
        seats_available: 5,
        seats_capacity: 30,
        non_reserved_seats: null,
        location: 'Online',
        meeting_times: 'MWF 9:00-9:50',
      });

      // Mock watcher exists
      mockRpc.mockResolvedValue({
        data: [{ user_id: 'user-1', email: 'test@example.com', watch_id: 'watch-1' }],
        error: null,
      });

      // seat_available already notified (empty); instructor_assigned still claimable.
      mockTryRecordNotificationsBatch
        .mockResolvedValueOnce(new Set()) // seat_available: nobody claimable → no resend
        .mockResolvedValueOnce(new Set(['watch-1'])); // instructor_assigned: claimable

      mockSendBatchEmailsOptimized.mockResolvedValue([{ success: true, id: 'email-1' }]);

      await POST(
        createRequest(
          JSON.stringify({ class_nbr: '12345', term: '2261' }),
          'Bearer test-cron-secret'
        )
      );

      // Non-destructive: no delete, and each type is claimed exactly once (no retry).
      expect(mockDeleteNotificationRecords).not.toHaveBeenCalled();
      const calls = mockTryRecordNotificationsBatch.mock.calls;
      const seatCalls = calls.filter((call) => call[1] === 'seat_available');
      const instructorCalls = calls.filter((call) => call[1] === 'instructor_assigned');
      expect(seatCalls.length).toBe(1);
      expect(instructorCalls.length).toBe(1);
    });

    it('should only claim notification types with detected changes', async () => {
      mockBaseline('Staff'); // baseline: 0 seats + Staff

      // ASU API: ONLY seat change (instructor stays Staff)
      mockFetchClassFromASU.mockResolvedValue({
        subject: 'CSE',
        catalog_nbr: '110',
        title: 'Intro to Programming',
        instructor_name: 'Staff', // No instructor change
        seats_available: 5,
        seats_capacity: 30,
        non_reserved_seats: null,
        location: 'Online',
        meeting_times: 'MWF 9:00-9:50',
      });

      // Mock watcher exists
      mockRpc.mockResolvedValue({
        data: [{ user_id: 'user-1', email: 'test@example.com', watch_id: 'watch-1' }],
        error: null,
      });

      // Mock notification recording to succeed (no stale records scenario)
      mockTryRecordNotificationsBatch.mockResolvedValue(new Set(['watch-1']));

      // Mock email sending
      mockSendBatchEmailsOptimized.mockResolvedValue([{ success: true, id: 'email-1' }]);

      await POST(
        createRequest(
          JSON.stringify({ class_nbr: '12345', term: '2261' }),
          'Bearer test-cron-secret'
        )
      );

      // Should only call tryRecordNotificationsBatch for seat_available, not instructor_assigned
      const calls = mockTryRecordNotificationsBatch.mock.calls;
      const seatCalls = calls.filter((call) => call[1] === 'seat_available');
      const instructorCalls = calls.filter((call) => call[1] === 'instructor_assigned');

      expect(seatCalls.length).toBeGreaterThanOrEqual(1);
      expect(instructorCalls.length).toBe(0); // No instructor change, so no recording

      // No cleanup should occur
      expect(mockDeleteNotificationRecords).not.toHaveBeenCalled();
    });

    it('does NOT delete when one type is claimable and the other is already notified', async () => {
      mockBaseline('Staff'); // baseline: 0 seats + Staff → both transitions fire

      // Mock ASU API to return class with both changes
      mockFetchClassFromASU.mockResolvedValue({
        subject: 'CSE',
        catalog_nbr: '110',
        title: 'Intro to Programming',
        instructor_name: 'Dr. Smith',
        seats_available: 5,
        seats_capacity: 30,
        non_reserved_seats: null,
        location: 'Online',
        meeting_times: 'MWF 9:00-9:50',
      });

      // Mock watcher exists
      mockRpc.mockResolvedValue({
        data: [{ user_id: 'user-1', email: 'test@example.com', watch_id: 'watch-1' }],
        error: null,
      });

      // seat_available claimable; instructor_assigned already notified (empty).
      mockTryRecordNotificationsBatch
        .mockResolvedValueOnce(new Set(['watch-1'])) // seat_available claimable
        .mockResolvedValueOnce(new Set()); // instructor_assigned already notified

      // Mock email sending
      mockSendBatchEmailsOptimized.mockResolvedValue([{ success: true, id: 'email-1' }]);

      await POST(
        createRequest(
          JSON.stringify({ class_nbr: '12345', term: '2261' }),
          'Bearer test-cron-secret'
        )
      );

      // Non-destructive: never delete, even when a type returns an empty claim set.
      expect(mockDeleteNotificationRecords).not.toHaveBeenCalled();
    });
  });
});
