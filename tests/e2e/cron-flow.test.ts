/**
 * E2E Test: Cron Flow Integration
 *
 * Tests the full cron -> queue flow for class checking.
 * Mocks Redis and database but tests the integration between components.
 *
 * Flow tested:
 * 1. Set up mock Redis
 * 2. Set up mock database with test class watches
 * 3. Call runClassCheckCron() directly
 * 4. Verify jobs were enqueued to BullMQ
 * 5. Verify worker would process them (mocked)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Track enqueued jobs for verification
const enqueuedJobs: Array<{
  name: string;
  data: unknown;
  opts?: { jobId?: string };
}> = [];

// Mock Redis client
const mockRedisClient = {
  get: vi.fn(),
  set: vi.fn(),
  del: vi.fn(),
  quit: vi.fn(),
};

vi.mock('@/lib/redis/client', () => ({
  getRedisClient: vi.fn(() => mockRedisClient),
  closeRedis: vi.fn(),
}));

// Mock cron lock
const mockAcquireLock = vi.fn();
const mockReleaseLock = vi.fn();

vi.mock('@/lib/redis/cron-lock', () => ({
  acquireLock: () => mockAcquireLock(),
  releaseLock: (lockId?: string) => mockReleaseLock(lockId),
}));

// Mock Supabase service client
const mockSupabaseRpc = vi.fn();

vi.mock('@/lib/supabase/service', () => ({
  getServiceClient: vi.fn(() => ({
    rpc: (...args: unknown[]) => mockSupabaseRpc(...args),
    from: vi.fn(),
  })),
}));

// Mock BullMQ Queue
class MockQueue {
  name: string;

  constructor(name: string) {
    this.name = name;
  }

  add = vi.fn(async (jobName: string, data: unknown, opts?: { jobId?: string }) => {
    const job = { name: jobName, data, opts };
    enqueuedJobs.push(job);
    return { id: opts?.jobId || `job-${enqueuedJobs.length}`, ...job };
  });

  addBulk = vi.fn(
    async (jobs: Array<{ name: string; data: unknown; opts?: { jobId?: string } }>) => {
      const results = jobs.map((job, idx) => {
        enqueuedJobs.push(job);
        return { id: job.opts?.jobId || `job-${idx}`, ...job };
      });
      return results;
    }
  );

  getJobCounts = vi.fn(async () => ({
    waiting: enqueuedJobs.length,
    active: 0,
    completed: 0,
    failed: 0,
    delayed: 0,
    paused: 0,
  }));

  close = vi.fn();
}

vi.mock('bullmq', () => ({
  Queue: MockQueue,
  Worker: vi.fn(),
}));

// Mock queue config
vi.mock('@/lib/queue/config', () => ({
  QUEUE_NAMES: {
    CLASS_CHECK: 'class-check',
    CLASS_CHECK_DLQ: 'class-check-dlq',
  },
  DEFAULT_JOB_OPTIONS: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 1000 },
    removeOnComplete: 100,
    removeOnFail: 500,
  },
  WORKER_CONFIG: {
    concurrency: 4,
    stalledInterval: 30000,
  },
}));

// Store original env
const originalEnv = { ...process.env };

describe('Cron Flow E2E', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Set time to :00 for even stagger group
    vi.setSystemTime(new Date('2026-01-15T12:00:00Z'));

    // Set required environment variables
    process.env.REDIS_URL = 'redis://localhost:6379';
    process.env.CRON_SECRET = 'test-cron-secret';

    // Reset mocks
    mockRedisClient.get.mockReset();
    mockRedisClient.set.mockReset();
    mockRedisClient.del.mockReset();
    mockAcquireLock.mockReset();
    mockReleaseLock.mockReset();
    mockSupabaseRpc.mockReset();

    // Clear enqueued jobs
    enqueuedJobs.length = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
    process.env = { ...originalEnv };
    vi.resetModules();
  });

  /**
   * Helper to set up successful lock acquisition
   */
  function setupLockAcquired(lockId = 'test-lock-id') {
    mockAcquireLock.mockResolvedValue({
      acquired: true,
      lockHolder: lockId,
      message: 'Lock acquired',
    });
    mockReleaseLock.mockResolvedValue({
      released: true,
      message: 'Lock released',
    });
  }

  /**
   * Helper to set up lock conflict
   */
  function setupLockConflict() {
    mockAcquireLock.mockResolvedValue({
      acquired: false,
      lockHolder: 'other-process',
      message: 'Lock held by other-process',
    });
  }

  /**
   * Helper to set up database sections to check
   */
  function setupSectionsToCheck(sections: Array<{ class_nbr: string; term: string }>) {
    mockSupabaseRpc.mockResolvedValue({
      data: sections,
      error: null,
    });
  }

  /**
   * Helper to set up database error
   */
  function setupDatabaseError(errorMessage: string) {
    mockSupabaseRpc.mockResolvedValue({
      data: null,
      error: { message: errorMessage },
    });
  }

  describe('runClassCheckCron', () => {
    it('should enqueue jobs for all sections from database', async () => {
      vi.resetModules();
      const { runClassCheckCron } = await import('@/lib/cron/class-check');

      setupLockAcquired();
      setupSectionsToCheck([
        { class_nbr: '12431', term: '2261' },
        { class_nbr: '12432', term: '2261' },
        { class_nbr: '12433', term: '2261' },
      ]);

      const result = await runClassCheckCron();

      expect(result.success).toBe(true);
      expect(result.sectionsEnqueued).toBe(3);
      expect(result.staggerGroup).toBe('even'); // :00 minute = even
      expect(enqueuedJobs).toHaveLength(3);

      // Verify job data structure
      expect(enqueuedJobs[0]).toMatchObject({
        name: 'check-section',
        data: {
          classNbr: '12431',
          term: '2261',
          staggerGroup: 'even',
        },
      });
    });

    it('should determine stagger group based on current time', async () => {
      vi.resetModules();

      // Test :00 -> even
      vi.setSystemTime(new Date('2026-01-15T12:00:00Z'));
      const { runClassCheckCron: runEven } = await import('@/lib/cron/class-check');

      setupLockAcquired();
      setupSectionsToCheck([{ class_nbr: '12431', term: '2261' }]);

      const evenResult = await runEven();
      expect(evenResult.staggerGroup).toBe('even');

      // Reset for next test
      vi.resetModules();
      enqueuedJobs.length = 0;

      // Test :30 -> odd
      vi.setSystemTime(new Date('2026-01-15T12:30:00Z'));
      const { runClassCheckCron: runOdd } = await import('@/lib/cron/class-check');

      setupLockAcquired();
      setupSectionsToCheck([{ class_nbr: '12432', term: '2261' }]);

      const oddResult = await runOdd();
      expect(oddResult.staggerGroup).toBe('odd');

      expect(enqueuedJobs[0].data).toMatchObject({
        staggerGroup: 'odd',
      });
    });

    it('should handle lock conflict gracefully', async () => {
      vi.resetModules();
      const { runClassCheckCron } = await import('@/lib/cron/class-check');

      setupLockConflict();

      const result = await runClassCheckCron();

      expect(result.success).toBe(false);
      expect(result.sectionsEnqueued).toBe(0);
      expect(result.error).toContain('Another cron job is already running');
      expect(enqueuedJobs).toHaveLength(0);

      // Should not query database when lock not acquired
      expect(mockSupabaseRpc).not.toHaveBeenCalled();
    });

    it('should release lock after successful completion', async () => {
      vi.resetModules();
      const { runClassCheckCron } = await import('@/lib/cron/class-check');

      setupLockAcquired('my-lock-id');
      setupSectionsToCheck([{ class_nbr: '12431', term: '2261' }]);

      await runClassCheckCron();

      expect(mockReleaseLock).toHaveBeenCalledWith('my-lock-id');
    });

    it('should release lock even on database error', async () => {
      vi.resetModules();
      const { runClassCheckCron } = await import('@/lib/cron/class-check');

      setupLockAcquired('my-lock-id');
      setupDatabaseError('Database connection failed');

      const result = await runClassCheckCron();

      expect(result.success).toBe(false);
      expect(result.error).toBe('Failed to fetch sections: Database connection failed');
      expect(mockReleaseLock).toHaveBeenCalledWith('my-lock-id');
    });

    it('should handle empty sections list', async () => {
      vi.resetModules();
      const { runClassCheckCron } = await import('@/lib/cron/class-check');

      setupLockAcquired();
      setupSectionsToCheck([]);

      const result = await runClassCheckCron();

      expect(result.success).toBe(true);
      expect(result.sectionsEnqueued).toBe(0);
      expect(enqueuedJobs).toHaveLength(0);
    });

    it('should pass correct stagger type to database query', async () => {
      vi.resetModules();
      const { runClassCheckCron } = await import('@/lib/cron/class-check');

      setupLockAcquired();
      setupSectionsToCheck([{ class_nbr: '12431', term: '2261' }]);

      await runClassCheckCron();

      // Verify database was called with correct stagger type
      expect(mockSupabaseRpc).toHaveBeenCalledWith('get_sections_to_check', {
        stagger_type: 'even',
      });
    });

    it('should include enqueuedAt timestamp in job data', async () => {
      vi.resetModules();
      const { runClassCheckCron } = await import('@/lib/cron/class-check');

      setupLockAcquired();
      setupSectionsToCheck([{ class_nbr: '12431', term: '2261' }]);

      await runClassCheckCron();

      const jobData = enqueuedJobs[0].data as { enqueuedAt: string };
      expect(jobData.enqueuedAt).toBe('2026-01-15T12:00:00.000Z');
    });

    it('should use term-classNbr as job ID for deduplication', async () => {
      vi.resetModules();
      const { runClassCheckCron } = await import('@/lib/cron/class-check');

      setupLockAcquired();
      setupSectionsToCheck([
        { class_nbr: '12431', term: '2261' },
        { class_nbr: '12432', term: '2261' },
      ]);

      await runClassCheckCron();

      expect(enqueuedJobs[0].opts?.jobId).toBe('2261-12431');
      expect(enqueuedJobs[1].opts?.jobId).toBe('2261-12432');
    });

    it('should track duration in result', async () => {
      vi.resetModules();
      const { runClassCheckCron } = await import('@/lib/cron/class-check');

      setupLockAcquired();
      setupSectionsToCheck([{ class_nbr: '12431', term: '2261' }]);

      const result = await runClassCheckCron();

      expect(result.durationMs).toBeGreaterThanOrEqual(0);
      expect(typeof result.durationMs).toBe('number');
    });
  });

  describe('Queue Integration', () => {
    it('should use bulk enqueue for multiple sections', async () => {
      vi.resetModules();
      const { runClassCheckCron } = await import('@/lib/cron/class-check');

      setupLockAcquired();
      setupSectionsToCheck([
        { class_nbr: '12431', term: '2261' },
        { class_nbr: '12432', term: '2261' },
        { class_nbr: '12433', term: '2261' },
        { class_nbr: '12434', term: '2261' },
        { class_nbr: '12435', term: '2261' },
      ]);

      await runClassCheckCron();

      // All jobs should be enqueued in one bulk operation
      expect(enqueuedJobs).toHaveLength(5);

      // Verify all jobs have correct structure
      for (const job of enqueuedJobs) {
        expect(job.name).toBe('check-section');
        const data = job.data as { classNbr: string; term: string; staggerGroup: string };
        expect(data.term).toBe('2261');
        expect(data.staggerGroup).toBe('even');
      }
    });
  });

  describe('Concurrent Execution Protection', () => {
    it('should prevent concurrent cron runs via lock', async () => {
      vi.resetModules();
      const { runClassCheckCron } = await import('@/lib/cron/class-check');

      // First run acquires lock
      setupLockAcquired('first-run');
      setupSectionsToCheck([{ class_nbr: '12431', term: '2261' }]);

      const firstResult = await runClassCheckCron();
      expect(firstResult.success).toBe(true);

      // Reset for second run
      vi.resetModules();
      enqueuedJobs.length = 0;

      // Second concurrent run gets lock conflict
      setupLockConflict();

      const { runClassCheckCron: runSecond } = await import('@/lib/cron/class-check');
      const secondResult = await runSecond();

      expect(secondResult.success).toBe(false);
      expect(secondResult.error).toContain('Another cron job is already running');
    });
  });

  describe('Error Recovery', () => {
    it('should not enqueue partial jobs on database error mid-fetch', async () => {
      vi.resetModules();
      const { runClassCheckCron } = await import('@/lib/cron/class-check');

      setupLockAcquired();
      setupDatabaseError('Connection timeout');

      const result = await runClassCheckCron();

      expect(result.success).toBe(false);
      expect(enqueuedJobs).toHaveLength(0);
    });

    it('should handle lock release failure silently', async () => {
      vi.resetModules();
      const { runClassCheckCron } = await import('@/lib/cron/class-check');

      mockAcquireLock.mockResolvedValue({
        acquired: true,
        lockHolder: 'test-lock',
        message: 'Lock acquired',
      });
      mockReleaseLock.mockRejectedValue(new Error('Redis unavailable'));
      setupSectionsToCheck([{ class_nbr: '12431', term: '2261' }]);

      // Should not throw even if lock release fails
      const result = await runClassCheckCron();

      // Main operation should still succeed
      expect(result.success).toBe(true);
      expect(result.sectionsEnqueued).toBe(1);
    });
  });
});
