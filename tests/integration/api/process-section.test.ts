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

  describe('change detection with null oldState (first observation)', () => {
    it('should detect seatBecameAvailable when oldState is null and seats are available', async () => {
      // Mock ASU API to return class with open seats
      mockFetchClassFromASU.mockResolvedValue({
        subject: 'CSE',
        catalog_nbr: '110',
        title: 'Intro to Programming',
        instructor: 'Dr. Smith',
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

      // Mock notification recording to succeed for both types
      mockTryRecordNotificationsBatch
        .mockResolvedValueOnce(new Set(['watch-1'])) // seat_available
        .mockResolvedValueOnce(new Set(['watch-1'])); // instructor_assigned

      // Mock email sending
      mockSendBatchEmailsOptimized.mockResolvedValue([
        { success: true, id: 'email-1' },
        { success: true, id: 'email-2' },
      ]);

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
      expect(data.changes_detected.seat_became_available).toBe(true);
      expect(data.changes_detected.instructor_assigned).toBe(true); // Staff -> Dr. Smith
      expect(data.emails_sent).toBe(2); // Both notifications
    });

    it('should detect instructorAssigned when oldState is null and instructor is not Staff', async () => {
      // Mock ASU API to return class with assigned instructor (not Staff)
      mockFetchClassFromASU.mockResolvedValue({
        subject: 'CSE',
        catalog_nbr: '110',
        title: 'Intro to Programming',
        instructor: 'Dr. Johnson', // Not 'Staff'
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

      // Mock email sending
      mockSendBatchEmailsOptimized.mockResolvedValue([{ success: true, id: 'email-1' }]);

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
      expect(data.changes_detected.seat_became_available).toBe(false); // 0 seats available
      expect(data.changes_detected.instructor_assigned).toBe(true); // Staff -> Dr. Johnson
      expect(data.emails_sent).toBe(1);
    });

    it('should detect both changes when oldState is null and both conditions are met', async () => {
      // Mock ASU API to return class with open seats and assigned instructor
      mockFetchClassFromASU.mockResolvedValue({
        subject: 'CSE',
        catalog_nbr: '110',
        title: 'Intro to Programming',
        instructor: 'Dr. Smith', // Not 'Staff'
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

      // Mock notification recording to succeed for both types
      mockTryRecordNotificationsBatch
        .mockResolvedValueOnce(new Set(['watch-1'])) // seat_available
        .mockResolvedValueOnce(new Set(['watch-1'])); // instructor_assigned

      // Mock email sending
      mockSendBatchEmailsOptimized.mockResolvedValue([
        { success: true, id: 'email-1' },
        { success: true, id: 'email-2' },
      ]);

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
      expect(data.changes_detected.seat_became_available).toBe(true);
      expect(data.changes_detected.instructor_assigned).toBe(true);
      expect(data.emails_sent).toBe(2);
    });

    it('should not trigger notifications when seats are 0 and instructor is Staff with null oldState', async () => {
      // Mock ASU API to return class with no seats and Staff instructor
      mockFetchClassFromASU.mockResolvedValue({
        subject: 'CSE',
        catalog_nbr: '110',
        title: 'Intro to Programming',
        instructor: 'Staff',
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
        instructor: 'Staff',
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
        '12345',
        '2261',
        'seat_available'
      );
    });
  });

  describe('rollback failure handling (issue #158)', () => {
    it('should return 500 when deleteNotificationRecords fails for seat_available emails', async () => {
      // Mock ASU API to return class with open seats
      mockFetchClassFromASU.mockResolvedValue({
        subject: 'CSE',
        catalog_nbr: '110',
        title: 'Intro to Programming',
        instructor: 'Dr. Smith',
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
      // Mock ASU API to return class with assigned instructor
      mockFetchClassFromASU.mockResolvedValue({
        subject: 'CSE',
        catalog_nbr: '110',
        title: 'Intro to Programming',
        instructor: 'Dr. Smith', // Not 'Staff'
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

  describe('notification cleanup optimization (issue #193)', () => {
    it('should NOT run cleanup when tryRecordNotificationsBatch succeeds on first attempt', async () => {
      // Mock ASU API to return class with open seats and assigned instructor
      mockFetchClassFromASU.mockResolvedValue({
        subject: 'CSE',
        catalog_nbr: '110',
        title: 'Intro to Programming',
        instructor: 'Dr. Smith',
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

    it('should run cleanup and retry when tryRecordNotificationsBatch returns empty set (stale records)', async () => {
      // Mock ASU API to return class with open seats
      mockFetchClassFromASU.mockResolvedValue({
        subject: 'CSE',
        catalog_nbr: '110',
        title: 'Intro to Programming',
        instructor: 'Dr. Smith',
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

      // Mock notification recording: seat_available has stale records, instructor_assigned succeeds first try
      mockTryRecordNotificationsBatch
        .mockResolvedValueOnce(new Set()) // seat_available: first attempt returns empty (stale)
        .mockResolvedValueOnce(new Set(['watch-1'])) // seat_available: retry succeeds after cleanup
        .mockResolvedValueOnce(new Set(['watch-1'])); // instructor_assigned: succeeds first try

      mockDeleteNotificationRecords.mockResolvedValue(undefined);

      // Mock email sending
      mockSendBatchEmailsOptimized.mockResolvedValue([{ success: true, id: 'email-1' }]);

      await POST(
        createRequest(
          JSON.stringify({ class_nbr: '12345', term: '2261' }),
          'Bearer test-cron-secret'
        )
      );

      // Cleanup should be called for seat_available type only (selective cleanup)
      expect(mockDeleteNotificationRecords).toHaveBeenCalledWith(['watch-1'], 'seat_available');
      // Should NOT cleanup instructor_assigned since no instructor change detected
      expect(mockDeleteNotificationRecords).not.toHaveBeenCalledWith(
        expect.anything(),
        'instructor_assigned'
      );

      // Verify cleanup-then-record ordering: retry happens after cleanup
      const calls = mockTryRecordNotificationsBatch.mock.calls;
      expect(calls.length).toBeGreaterThanOrEqual(2);
      // First call should be before cleanup
      expect(calls[0]).toEqual([['watch-1'], 'seat_available']);
      // Second call (retry) should be after cleanup
      expect(calls[1]).toEqual([['watch-1'], 'seat_available']);
    });

    it('should only cleanup notification types with detected changes', async () => {
      // Mock ASU API to return class with ONLY seat change (instructor is Staff)
      mockFetchClassFromASU.mockResolvedValue({
        subject: 'CSE',
        catalog_nbr: '110',
        title: 'Intro to Programming',
        instructor: 'Staff', // No instructor change
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

      // No cleanup should occur since first attempt succeeded
      expect(mockDeleteNotificationRecords).not.toHaveBeenCalled();
    });

    it('should handle partial stale records (one type succeeds, other needs cleanup)', async () => {
      // Mock ASU API to return class with both changes
      mockFetchClassFromASU.mockResolvedValue({
        subject: 'CSE',
        catalog_nbr: '110',
        title: 'Intro to Programming',
        instructor: 'Dr. Smith',
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

      // Mock: seat_available succeeds, instructor_assigned has stale records
      mockTryRecordNotificationsBatch
        .mockResolvedValueOnce(new Set(['watch-1'])) // seat_available succeeds
        .mockResolvedValueOnce(new Set()) // instructor_assigned returns empty (stale)
        .mockResolvedValueOnce(new Set(['watch-1'])); // retry instructor succeeds

      mockDeleteNotificationRecords.mockResolvedValue(undefined);

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

      // Should only cleanup instructor_assigned (the one that returned empty)
      expect(mockDeleteNotificationRecords).toHaveBeenCalledWith(
        ['watch-1'],
        'instructor_assigned'
      );
      // Should NOT cleanup seat_available (it succeeded on first try)
      expect(mockDeleteNotificationRecords).not.toHaveBeenCalledWith(
        expect.anything(),
        'seat_available'
      );
    });
  });
});
