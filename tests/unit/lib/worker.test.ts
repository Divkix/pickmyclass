/**
 * Unit Tests for Queue Worker
 *
 * Tests the job processing logic for class checks.
 * Mocks all external dependencies: Redis, database, scraper, email.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock Redis client for circuit breaker
const mockRedisClient = {
  get: vi.fn(),
  set: vi.fn(),
};

vi.mock('@/lib/redis/client', () => ({
  getRedisClient: vi.fn(() => mockRedisClient),
}));

// Mock Supabase service client
const mockSupabaseFrom = vi.fn();
const mockSupabaseRpc = vi.fn();

vi.mock('@/lib/supabase/service', () => ({
  getServiceClient: vi.fn(() => ({
    from: (...args: unknown[]) => mockSupabaseFrom(...args),
    rpc: (...args: unknown[]) => mockSupabaseRpc(...args),
  })),
}));

// Mock database queries
const mockTryRecordNotification = vi.fn();
const mockResetNotificationsForSection = vi.fn();

vi.mock('@/lib/db/queries', () => ({
  tryRecordNotification: (...args: unknown[]) => mockTryRecordNotification(...args),
  resetNotificationsForSection: (...args: unknown[]) => mockResetNotificationsForSection(...args),
}));

// Mock email service
const mockSendBatchEmailsOptimized = vi.fn();

vi.mock('@/lib/email/resend', () => ({
  sendBatchEmailsOptimized: (...args: unknown[]) => mockSendBatchEmailsOptimized(...args),
}));

// Mock BullMQ - we need to mock the Worker class as a constructor
const mockWorkerOn = vi.fn();
const mockWorkerClose = vi.fn();

// Store processor to call it in tests
let jobProcessor: ((...args: unknown[]) => Promise<unknown>) | null = null;

class MockWorker {
  constructor(_queueName: string, processor: (...args: unknown[]) => Promise<unknown>) {
    jobProcessor = processor;
  }
  on = mockWorkerOn;
  close = mockWorkerClose;
}

vi.mock('bullmq', () => ({
  Worker: MockWorker,
  Queue: vi.fn(),
}));

// Mock queue config and connection
vi.mock('@/lib/queue/config', () => ({
  QUEUE_NAMES: {
    CLASS_CHECK: 'class-check',
    CLASS_CHECK_DLQ: 'class-check-dlq',
  },
  WORKER_CONFIG: {
    concurrency: 4,
    stalledInterval: 30000,
  },
}));

vi.mock('@/lib/queue/queues', () => ({
  getConnectionOptions: vi.fn(() => ({
    host: 'localhost',
    port: 6379,
    maxRetriesPerRequest: null,
  })),
}));

// Mock fetch for scraper
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Store original env values
const originalEnv = { ...process.env };

describe('Queue Worker', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-15T12:00:00Z'));

    // Set environment variables
    process.env.SCRAPER_URL = 'https://scraper.test';
    process.env.SCRAPER_SECRET_TOKEN = 'test-token';

    // Reset all mocks
    mockRedisClient.get.mockReset();
    mockRedisClient.set.mockReset();
    mockSupabaseFrom.mockReset();
    mockSupabaseRpc.mockReset();
    mockTryRecordNotification.mockReset();
    mockResetNotificationsForSection.mockReset();
    mockSendBatchEmailsOptimized.mockReset();
    mockFetch.mockReset();
    mockWorkerOn.mockReset();
    mockWorkerClose.mockResolvedValue(undefined);

    // Reset processor
    jobProcessor = null;
  });

  afterEach(() => {
    vi.useRealTimers();
    // Restore original env
    process.env = { ...originalEnv };
  });

  /**
   * Helper to create a mock job
   */
  function createMockJob(data: {
    classNbr: string;
    term: string;
    enqueuedAt: string;
    staggerGroup: 'even' | 'odd';
  }) {
    return {
      id: `${data.term}-${data.classNbr}`,
      data,
      attemptsMade: 0,
      opts: {
        attempts: 3,
      },
    };
  }

  /**
   * Helper to set up circuit breaker as CLOSED (healthy)
   */
  function setupCircuitBreakerClosed() {
    mockRedisClient.get.mockResolvedValue(
      JSON.stringify({
        state: 'CLOSED',
        failureCount: 0,
        successCount: 0,
        lastFailureTime: null,
        lastStateChange: Date.now(),
      })
    );
    mockRedisClient.set.mockResolvedValue('OK');
  }

  /**
   * Helper to set up circuit breaker as OPEN (blocking)
   */
  function setupCircuitBreakerOpen() {
    mockRedisClient.get.mockResolvedValue(
      JSON.stringify({
        state: 'OPEN',
        failureCount: 10,
        successCount: 0,
        lastFailureTime: Date.now(),
        lastStateChange: Date.now(),
      })
    );
  }

  /**
   * Helper to set up successful scraper response
   */
  function setupScraperSuccess(data: Record<string, unknown> = {}) {
    const defaultData = {
      subject: 'CSE',
      catalog_nbr: '101',
      title: 'Introduction to Computer Science',
      instructor: 'Dr. Smith',
      seats_available: 5,
      seats_capacity: 30,
      non_reserved_seats: 3,
      location: 'COOR 120',
      meeting_times: 'MWF 10:00-10:50',
    };

    mockFetch.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        success: true,
        data: { ...defaultData, ...data },
      }),
    });
  }

  /**
   * Helper to set up database with old class state
   */
  function setupOldClassState(state: Record<string, unknown> | null) {
    mockSupabaseFrom.mockImplementation((table: string) => {
      if (table === 'class_states') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: state,
                error: state === null ? { code: 'PGRST116' } : null,
              }),
            }),
          }),
          upsert: vi.fn().mockResolvedValue({ error: null }),
        };
      }
      return {};
    });
  }

  /**
   * Helper to set up watchers for a section
   */
  function setupWatchers(watchers: Array<{ watch_id: string; user_id: string; email: string }>) {
    mockSupabaseRpc.mockResolvedValue({
      data: watchers,
      error: null,
    });
  }

  /**
   * Helper to start worker and get the job processor
   */
  async function getJobProcessor() {
    // Reset modules to get fresh import
    vi.resetModules();

    // Re-import worker module
    const { startWorker } = await import('@/lib/queue/worker');
    startWorker();

    if (!jobProcessor) {
      throw new Error('Job processor not captured');
    }

    return jobProcessor;
  }

  describe('startWorker', () => {
    it('should register event handlers on worker', async () => {
      await getJobProcessor();

      expect(mockWorkerOn).toHaveBeenCalledWith('completed', expect.any(Function));
      expect(mockWorkerOn).toHaveBeenCalledWith('failed', expect.any(Function));
      expect(mockWorkerOn).toHaveBeenCalledWith('error', expect.any(Function));
      expect(mockWorkerOn).toHaveBeenCalledWith('stalled', expect.any(Function));
    });
  });

  describe('stopWorker', () => {
    it('should close worker gracefully', async () => {
      vi.resetModules();
      const { startWorker, stopWorker } = await import('@/lib/queue/worker');

      startWorker();
      await stopWorker();

      expect(mockWorkerClose).toHaveBeenCalled();
    });

    it('should handle stop when no worker running', async () => {
      vi.resetModules();
      const { stopWorker } = await import('@/lib/queue/worker');

      // Should not throw
      await stopWorker();
    });
  });

  describe('job processing - no changes detected', () => {
    it('should process job successfully when no changes detected', async () => {
      const processor = await getJobProcessor();

      setupCircuitBreakerClosed();
      setupOldClassState({
        class_nbr: '12431',
        seats_available: 5,
        non_reserved_seats: 3,
        instructor_name: 'Dr. Smith',
      });
      setupScraperSuccess({
        seats_available: 5,
        non_reserved_seats: 3,
        instructor: 'Dr. Smith',
      });

      const job = createMockJob({
        classNbr: '12431',
        term: '2261',
        enqueuedAt: new Date().toISOString(),
        staggerGroup: 'odd',
      });

      const result = (await processor(job)) as {
        success: boolean;
        classNbr: string;
        seatsAvailable?: boolean;
        notificationsSent?: number;
      };

      expect(result.success).toBe(true);
      expect(result.classNbr).toBe('12431');
      expect(result.seatsAvailable).toBeFalsy();
      expect(result.notificationsSent).toBe(0);
    });
  });

  describe('job processing - seat availability change', () => {
    it('should detect seat availability and send notifications', async () => {
      const processor = await getJobProcessor();

      setupCircuitBreakerClosed();

      // Old state: no seats available
      mockSupabaseFrom.mockImplementation((table: string) => {
        if (table === 'class_states') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: {
                    class_nbr: '12431',
                    seats_available: 0,
                    non_reserved_seats: 0,
                    instructor_name: 'Dr. Smith',
                  },
                  error: null,
                }),
              }),
            }),
            upsert: vi.fn().mockResolvedValue({ error: null }),
          };
        }
        return {};
      });

      // New state: seats available
      setupScraperSuccess({
        seats_available: 3,
        non_reserved_seats: 2,
        instructor: 'Dr. Smith',
      });

      setupWatchers([
        { watch_id: 'watch-1', user_id: 'user-1', email: 'user1@test.com' },
        { watch_id: 'watch-2', user_id: 'user-2', email: 'user2@test.com' },
      ]);

      mockTryRecordNotification.mockResolvedValue(true);
      mockSendBatchEmailsOptimized.mockResolvedValue([
        { success: true, messageId: 'msg-1' },
        { success: true, messageId: 'msg-2' },
      ]);

      const job = createMockJob({
        classNbr: '12431',
        term: '2261',
        enqueuedAt: new Date().toISOString(),
        staggerGroup: 'odd',
      });

      const result = (await processor(job)) as {
        success: boolean;
        seatsAvailable?: boolean;
        notificationsSent?: number;
      };

      expect(result.success).toBe(true);
      expect(result.seatsAvailable).toBe(true);
      expect(result.notificationsSent).toBe(2);
      expect(mockSendBatchEmailsOptimized).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            to: 'user1@test.com',
            type: 'seat_available',
          }),
          expect.objectContaining({
            to: 'user2@test.com',
            type: 'seat_available',
          }),
        ])
      );
    });

    it('should skip notifications for already-notified watchers', async () => {
      const processor = await getJobProcessor();

      setupCircuitBreakerClosed();

      mockSupabaseFrom.mockImplementation((table: string) => {
        if (table === 'class_states') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: {
                    class_nbr: '12431',
                    seats_available: 0,
                    non_reserved_seats: 0,
                    instructor_name: 'Dr. Smith',
                  },
                  error: null,
                }),
              }),
            }),
            upsert: vi.fn().mockResolvedValue({ error: null }),
          };
        }
        return {};
      });

      setupScraperSuccess({
        seats_available: 3,
        non_reserved_seats: 2,
        instructor: 'Dr. Smith',
      });

      setupWatchers([
        { watch_id: 'watch-1', user_id: 'user-1', email: 'user1@test.com' },
        { watch_id: 'watch-2', user_id: 'user-2', email: 'user2@test.com' },
      ]);

      // First watcher already notified, second should be notified
      mockTryRecordNotification
        .mockResolvedValueOnce(false) // watch-1 already notified
        .mockResolvedValueOnce(true); // watch-2 new notification

      mockSendBatchEmailsOptimized.mockResolvedValue([{ success: true, messageId: 'msg-2' }]);

      const job = createMockJob({
        classNbr: '12431',
        term: '2261',
        enqueuedAt: new Date().toISOString(),
        staggerGroup: 'odd',
      });

      const result = (await processor(job)) as {
        success: boolean;
        notificationsSent?: number;
      };

      expect(result.success).toBe(true);
      expect(result.notificationsSent).toBe(1);
      expect(mockSendBatchEmailsOptimized).toHaveBeenCalledWith([
        expect.objectContaining({
          to: 'user2@test.com',
          type: 'seat_available',
        }),
      ]);
    });

    it('should reset notifications when seats fill back to zero', async () => {
      const processor = await getJobProcessor();

      setupCircuitBreakerClosed();

      // Old state: seats were available
      mockSupabaseFrom.mockImplementation((table: string) => {
        if (table === 'class_states') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: {
                    class_nbr: '12431',
                    seats_available: 5,
                    non_reserved_seats: 3,
                    instructor_name: 'Dr. Smith',
                  },
                  error: null,
                }),
              }),
            }),
            upsert: vi.fn().mockResolvedValue({ error: null }),
          };
        }
        return {};
      });

      // New state: no seats available
      setupScraperSuccess({
        seats_available: 0,
        non_reserved_seats: 0,
        instructor: 'Dr. Smith',
      });

      const job = createMockJob({
        classNbr: '12431',
        term: '2261',
        enqueuedAt: new Date().toISOString(),
        staggerGroup: 'odd',
      });

      await processor(job);

      expect(mockResetNotificationsForSection).toHaveBeenCalledWith('12431', 'seat_available');
    });
  });

  describe('job processing - instructor assignment change', () => {
    it('should detect instructor assignment and send notifications', async () => {
      const processor = await getJobProcessor();

      setupCircuitBreakerClosed();

      // Old state: Staff instructor
      mockSupabaseFrom.mockImplementation((table: string) => {
        if (table === 'class_states') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: {
                    class_nbr: '12431',
                    seats_available: 10,
                    non_reserved_seats: 8,
                    instructor_name: 'Staff',
                  },
                  error: null,
                }),
              }),
            }),
            upsert: vi.fn().mockResolvedValue({ error: null }),
          };
        }
        return {};
      });

      // New state: instructor assigned
      setupScraperSuccess({
        seats_available: 10,
        non_reserved_seats: 8,
        instructor: 'Dr. Johnson',
      });

      setupWatchers([{ watch_id: 'watch-1', user_id: 'user-1', email: 'user1@test.com' }]);

      mockTryRecordNotification.mockResolvedValue(true);
      mockSendBatchEmailsOptimized.mockResolvedValue([{ success: true, messageId: 'msg-1' }]);

      const job = createMockJob({
        classNbr: '12431',
        term: '2261',
        enqueuedAt: new Date().toISOString(),
        staggerGroup: 'odd',
      });

      const result = (await processor(job)) as {
        success: boolean;
      };

      expect(result.success).toBe(true);
      expect(mockSendBatchEmailsOptimized).toHaveBeenCalledWith([
        expect.objectContaining({
          type: 'instructor_assigned',
        }),
      ]);
    });

    it('should send both seat and instructor notifications when both change', async () => {
      const processor = await getJobProcessor();

      setupCircuitBreakerClosed();

      // Old state: no seats, Staff instructor
      mockSupabaseFrom.mockImplementation((table: string) => {
        if (table === 'class_states') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: {
                    class_nbr: '12431',
                    seats_available: 0,
                    non_reserved_seats: 0,
                    instructor_name: 'Staff',
                  },
                  error: null,
                }),
              }),
            }),
            upsert: vi.fn().mockResolvedValue({ error: null }),
          };
        }
        return {};
      });

      // New state: seats available AND instructor assigned
      setupScraperSuccess({
        seats_available: 5,
        non_reserved_seats: 3,
        instructor: 'Dr. Johnson',
      });

      setupWatchers([{ watch_id: 'watch-1', user_id: 'user-1', email: 'user1@test.com' }]);

      mockTryRecordNotification.mockResolvedValue(true);
      mockSendBatchEmailsOptimized.mockResolvedValue([
        { success: true, messageId: 'msg-1' },
        { success: true, messageId: 'msg-2' },
      ]);

      const job = createMockJob({
        classNbr: '12431',
        term: '2261',
        enqueuedAt: new Date().toISOString(),
        staggerGroup: 'odd',
      });

      const result = (await processor(job)) as {
        success: boolean;
        notificationsSent?: number;
      };

      expect(result.success).toBe(true);
      expect(result.notificationsSent).toBe(2);
      expect(mockSendBatchEmailsOptimized).toHaveBeenCalledWith([
        expect.objectContaining({ type: 'seat_available' }),
        expect.objectContaining({ type: 'instructor_assigned' }),
      ]);
    });
  });

  describe('job processing - circuit breaker handling', () => {
    it('should throw error when circuit breaker is OPEN to trigger retry', async () => {
      const processor = await getJobProcessor();

      setupCircuitBreakerOpen();

      mockSupabaseFrom.mockImplementation((table: string) => {
        if (table === 'class_states') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: null,
                  error: { code: 'PGRST116' },
                }),
              }),
            }),
          };
        }
        return {};
      });

      const job = createMockJob({
        classNbr: '12431',
        term: '2261',
        enqueuedAt: new Date().toISOString(),
        staggerGroup: 'odd',
      });

      // When circuit breaker is OPEN, job should throw to trigger BullMQ retry
      await expect(processor(job)).rejects.toThrow('Circuit breaker is OPEN');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should record failure in circuit breaker when scraper fails', async () => {
      const processor = await getJobProcessor();

      setupCircuitBreakerClosed();

      mockSupabaseFrom.mockImplementation((table: string) => {
        if (table === 'class_states') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: null,
                  error: { code: 'PGRST116' },
                }),
              }),
            }),
          };
        }
        return {};
      });

      // Scraper throws error
      mockFetch.mockRejectedValue(new Error('Network error'));

      const job = createMockJob({
        classNbr: '12431',
        term: '2261',
        enqueuedAt: new Date().toISOString(),
        staggerGroup: 'odd',
      });

      await expect(processor(job)).rejects.toThrow('Network error');

      // Should have called set to record failure
      expect(mockRedisClient.set).toHaveBeenCalled();
    });

    it('should record success in circuit breaker when scraper succeeds', async () => {
      const processor = await getJobProcessor();

      setupCircuitBreakerClosed();

      mockSupabaseFrom.mockImplementation((table: string) => {
        if (table === 'class_states') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: null,
                  error: { code: 'PGRST116' },
                }),
              }),
            }),
            upsert: vi.fn().mockResolvedValue({ error: null }),
          };
        }
        return {};
      });

      setupScraperSuccess();

      const job = createMockJob({
        classNbr: '12431',
        term: '2261',
        enqueuedAt: new Date().toISOString(),
        staggerGroup: 'odd',
      });

      await processor(job);

      // Should have called set to record success
      expect(mockRedisClient.set).toHaveBeenCalled();
    });
  });

  describe('job processing - error handling', () => {
    it('should throw error and trigger retry on database error', async () => {
      const processor = await getJobProcessor();

      setupCircuitBreakerClosed();

      mockSupabaseFrom.mockImplementation((table: string) => {
        if (table === 'class_states') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: null,
                  error: { code: 'PGRST116' },
                }),
              }),
            }),
            upsert: vi.fn().mockResolvedValue({
              error: { message: 'Database connection lost' },
            }),
          };
        }
        return {};
      });

      setupScraperSuccess();

      const job = createMockJob({
        classNbr: '12431',
        term: '2261',
        enqueuedAt: new Date().toISOString(),
        staggerGroup: 'odd',
      });

      await expect(processor(job)).rejects.toThrow('Database error');
    });

    it('should handle scraper HTTP error', async () => {
      const processor = await getJobProcessor();

      setupCircuitBreakerClosed();

      mockSupabaseFrom.mockImplementation((table: string) => {
        if (table === 'class_states') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: null,
                  error: { code: 'PGRST116' },
                }),
              }),
            }),
          };
        }
        return {};
      });

      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      const job = createMockJob({
        classNbr: '12431',
        term: '2261',
        enqueuedAt: new Date().toISOString(),
        staggerGroup: 'odd',
      });

      await expect(processor(job)).rejects.toThrow('Scraper returned 500');
    });

    it('should handle email send partial failure', async () => {
      const processor = await getJobProcessor();

      setupCircuitBreakerClosed();

      mockSupabaseFrom.mockImplementation((table: string) => {
        if (table === 'class_states') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: {
                    class_nbr: '12431',
                    seats_available: 0,
                    non_reserved_seats: 0,
                    instructor_name: 'Dr. Smith',
                  },
                  error: null,
                }),
              }),
            }),
            upsert: vi.fn().mockResolvedValue({ error: null }),
          };
        }
        return {};
      });

      setupScraperSuccess({
        seats_available: 3,
        non_reserved_seats: 2,
      });

      setupWatchers([
        { watch_id: 'watch-1', user_id: 'user-1', email: 'user1@test.com' },
        { watch_id: 'watch-2', user_id: 'user-2', email: 'user2@test.com' },
      ]);

      mockTryRecordNotification.mockResolvedValue(true);

      // One email succeeds, one fails
      mockSendBatchEmailsOptimized.mockResolvedValue([
        { success: true, messageId: 'msg-1' },
        { success: false, error: 'Invalid email' },
      ]);

      const job = createMockJob({
        classNbr: '12431',
        term: '2261',
        enqueuedAt: new Date().toISOString(),
        staggerGroup: 'odd',
      });

      const result = (await processor(job)) as {
        success: boolean;
        notificationsSent?: number;
      };

      // Should still succeed but only count successful emails
      expect(result.success).toBe(true);
      expect(result.notificationsSent).toBe(1);
    });

    it('should handle missing scraper environment variables', async () => {
      // Remove scraper env vars before importing
      process.env.SCRAPER_URL = '';
      process.env.SCRAPER_SECRET_TOKEN = '';

      const processor = await getJobProcessor();

      setupCircuitBreakerClosed();

      mockSupabaseFrom.mockImplementation((table: string) => {
        if (table === 'class_states') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: null,
                  error: { code: 'PGRST116' },
                }),
              }),
            }),
          };
        }
        return {};
      });

      const job = createMockJob({
        classNbr: '12431',
        term: '2261',
        enqueuedAt: new Date().toISOString(),
        staggerGroup: 'odd',
      });

      await expect(processor(job)).rejects.toThrow(
        'SCRAPER_URL and SCRAPER_SECRET_TOKEN must be set'
      );
    });
  });

  describe('job processing - first check (no old state)', () => {
    it('should handle first check when no previous state exists', async () => {
      const processor = await getJobProcessor();

      setupCircuitBreakerClosed();

      // No previous state
      mockSupabaseFrom.mockImplementation((table: string) => {
        if (table === 'class_states') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: null,
                  error: { code: 'PGRST116' },
                }),
              }),
            }),
            upsert: vi.fn().mockResolvedValue({ error: null }),
          };
        }
        return {};
      });

      setupScraperSuccess({
        seats_available: 5,
        non_reserved_seats: 3,
        instructor: 'Dr. Smith',
      });

      const job = createMockJob({
        classNbr: '12431',
        term: '2261',
        enqueuedAt: new Date().toISOString(),
        staggerGroup: 'odd',
      });

      const result = (await processor(job)) as {
        success: boolean;
        seatsAvailable?: boolean;
        notificationsSent?: number;
      };

      expect(result.success).toBe(true);
      // No change detection on first check (no old state to compare)
      expect(result.seatsAvailable).toBeFalsy();
      expect(result.notificationsSent).toBe(0);
    });
  });

  describe('job processing - non-reserved seats logic', () => {
    it('should prefer non-reserved seats when available', async () => {
      const processor = await getJobProcessor();

      setupCircuitBreakerClosed();

      // Old state: total seats available but non-reserved is 0
      mockSupabaseFrom.mockImplementation((table: string) => {
        if (table === 'class_states') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: {
                    class_nbr: '12431',
                    seats_available: 5,
                    non_reserved_seats: 0, // No non-reserved seats
                    instructor_name: 'Dr. Smith',
                  },
                  error: null,
                }),
              }),
            }),
            upsert: vi.fn().mockResolvedValue({ error: null }),
          };
        }
        return {};
      });

      // New state: non-reserved seats now available
      setupScraperSuccess({
        seats_available: 5,
        non_reserved_seats: 2, // Now has non-reserved seats
        instructor: 'Dr. Smith',
      });

      setupWatchers([{ watch_id: 'watch-1', user_id: 'user-1', email: 'user1@test.com' }]);

      mockTryRecordNotification.mockResolvedValue(true);
      mockSendBatchEmailsOptimized.mockResolvedValue([{ success: true }]);

      const job = createMockJob({
        classNbr: '12431',
        term: '2261',
        enqueuedAt: new Date().toISOString(),
        staggerGroup: 'odd',
      });

      const result = (await processor(job)) as {
        success: boolean;
        seatsAvailable?: boolean;
      };

      // Should detect change from 0 to 2 non-reserved seats
      expect(result.success).toBe(true);
      expect(result.seatsAvailable).toBe(true);
    });

    it('should fall back to total available when non-reserved is null', async () => {
      const processor = await getJobProcessor();

      setupCircuitBreakerClosed();

      // Old state: null non-reserved, 0 total
      mockSupabaseFrom.mockImplementation((table: string) => {
        if (table === 'class_states') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: {
                    class_nbr: '12431',
                    seats_available: 0,
                    non_reserved_seats: null,
                    instructor_name: 'Dr. Smith',
                  },
                  error: null,
                }),
              }),
            }),
            upsert: vi.fn().mockResolvedValue({ error: null }),
          };
        }
        return {};
      });

      // New state: null non-reserved, 3 total available
      setupScraperSuccess({
        seats_available: 3,
        non_reserved_seats: null,
        instructor: 'Dr. Smith',
      });

      setupWatchers([{ watch_id: 'watch-1', user_id: 'user-1', email: 'user1@test.com' }]);

      mockTryRecordNotification.mockResolvedValue(true);
      mockSendBatchEmailsOptimized.mockResolvedValue([{ success: true }]);

      const job = createMockJob({
        classNbr: '12431',
        term: '2261',
        enqueuedAt: new Date().toISOString(),
        staggerGroup: 'odd',
      });

      const result = (await processor(job)) as {
        success: boolean;
        seatsAvailable?: boolean;
      };

      // Should detect change using total available
      expect(result.success).toBe(true);
      expect(result.seatsAvailable).toBe(true);
    });
  });

  describe('getWorker', () => {
    it('should return null when no worker is running', async () => {
      vi.resetModules();
      const { getWorker } = await import('@/lib/queue/worker');

      const worker = getWorker();

      expect(worker).toBeNull();
    });

    it('should return worker instance when running', async () => {
      vi.resetModules();
      const { startWorker, getWorker } = await import('@/lib/queue/worker');

      startWorker();
      const worker = getWorker();

      expect(worker).not.toBeNull();
    });
  });
});
