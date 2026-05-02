import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
vi.mock('@/lib/email/resend', () => ({
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
          single: vi.fn().mockResolvedValue({ data: null, error: { code: 'PGRST116' } }),
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
  });
});
