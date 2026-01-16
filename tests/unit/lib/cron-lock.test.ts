import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock Redis client
const mockRedisClient = {
  set: vi.fn(),
  get: vi.fn(),
  pttl: vi.fn(),
  del: vi.fn(),
  eval: vi.fn(),
};

vi.mock('@/lib/redis/client', () => ({
  getRedisClient: vi.fn(() => mockRedisClient),
}));

// Import after mocking
const { acquireLock, releaseLock, getStatus, forceRelease } = await import('@/lib/redis/cron-lock');

describe('CronLock', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-15T12:00:00Z'));
    mockRedisClient.set.mockReset();
    mockRedisClient.get.mockReset();
    mockRedisClient.pttl.mockReset();
    mockRedisClient.del.mockReset();
    mockRedisClient.eval.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    // Reset module state between tests by clearing cached imports
    vi.resetModules();
  });

  describe('acquireLock', () => {
    it('should acquire lock when not held', async () => {
      mockRedisClient.set.mockResolvedValue('OK');

      const result = await acquireLock('test-lock-id');

      expect(result.acquired).toBe(true);
      expect(result.message).toBe('Lock acquired successfully');
      expect(result.lockHolder).toBe('test-lock-id');
      expect(result.lockedSince).toBe(Date.now());
    });

    it('should use auto-generated lock ID when not provided', async () => {
      mockRedisClient.set.mockResolvedValue('OK');

      const result = await acquireLock();

      expect(result.acquired).toBe(true);
      expect(result.lockHolder).toMatch(/^\d+-[a-z0-9]+$/);
    });

    it('should fail to acquire lock when already held by someone else', async () => {
      // First call to SET NX returns null (lock already held)
      mockRedisClient.set.mockResolvedValue(null);
      mockRedisClient.get
        .mockResolvedValueOnce('other-holder-123') // existing lock holder
        .mockResolvedValueOnce(
          JSON.stringify({
            lockHolder: 'other-holder-123',
            lockAcquiredAt: Date.now() - 60000,
          })
        ); // metadata
      mockRedisClient.pttl.mockResolvedValue(1440000); // 24 minutes remaining

      const result = await acquireLock('new-lock-id');

      expect(result.acquired).toBe(false);
      expect(result.message).toContain('already held by other-holder-123');
      expect(result.lockHolder).toBe('other-holder-123');
    });

    it('should use correct Redis key for lock', async () => {
      mockRedisClient.set.mockResolvedValue('OK');

      await acquireLock('test-id', 'custom-lock-name');

      expect(mockRedisClient.set).toHaveBeenCalledWith(
        'cron-lock:custom-lock-name',
        'test-id',
        'PX',
        25 * 60 * 1000, // 25 minutes
        'NX'
      );
    });

    it('should use default lock name when not provided', async () => {
      mockRedisClient.set.mockResolvedValue('OK');

      await acquireLock('test-id');

      expect(mockRedisClient.set).toHaveBeenCalledWith(
        'cron-lock:class-check-cron',
        expect.any(String),
        'PX',
        25 * 60 * 1000,
        'NX'
      );
    });

    it('should store metadata when lock acquired', async () => {
      mockRedisClient.set.mockResolvedValue('OK');

      await acquireLock('test-id');

      // Second call should be metadata storage
      expect(mockRedisClient.set).toHaveBeenCalledTimes(2);
      expect(mockRedisClient.set).toHaveBeenLastCalledWith(
        'cron-lock:class-check-cron:meta',
        expect.stringContaining('"lockHolder":"test-id"'),
        'PX',
        25 * 60 * 1000
      );
    });

    it('should handle Redis error gracefully during acquisition', async () => {
      mockRedisClient.set.mockRejectedValue(new Error('Redis connection failed'));

      const result = await acquireLock('test-id');

      expect(result.acquired).toBe(false);
      expect(result.message).toContain('Redis error');
    });

    it('should handle metadata storage failure gracefully', async () => {
      // Lock acquisition succeeds
      mockRedisClient.set
        .mockResolvedValueOnce('OK') // Lock acquisition
        .mockRejectedValueOnce(new Error('Metadata storage failed')); // Metadata storage

      const result = await acquireLock('test-id');

      // Should still report success since lock was acquired
      expect(result.acquired).toBe(true);
      expect(result.message).toBe('Lock acquired successfully');
    });
  });

  describe('releaseLock', () => {
    it('should release lock when we hold it', async () => {
      // First acquire the lock to set internal state
      mockRedisClient.set.mockResolvedValue('OK');
      await acquireLock('our-lock-id');

      // Now release it
      mockRedisClient.eval.mockResolvedValue(1);

      const result = await releaseLock('our-lock-id');

      expect(result.released).toBe(true);
      expect(result.message).toBe('Lock released successfully');
    });

    it('should use remembered lock ID when not provided', async () => {
      // Acquire lock to set internal state
      mockRedisClient.set.mockResolvedValue('OK');
      const acquireResult = await acquireLock('remembered-id');

      // Release without providing ID
      mockRedisClient.eval.mockResolvedValue(1);

      const result = await releaseLock();

      expect(result.released).toBe(true);
      // Lua script should receive the remembered ID
      expect(mockRedisClient.eval).toHaveBeenCalledWith(
        expect.any(String), // Lua script
        2, // number of keys
        'cron-lock:class-check-cron',
        'cron-lock:class-check-cron:meta',
        acquireResult.lockHolder
      );
    });

    it('should fail to release lock when held by someone else', async () => {
      // Lua script returns 0 (lock not held by us)
      mockRedisClient.eval.mockResolvedValue(0);
      mockRedisClient.get.mockResolvedValue('other-holder');

      const result = await releaseLock('our-id');

      expect(result.released).toBe(false);
      expect(result.message).toContain('held by different holder');
    });

    it('should fail when lock already expired', async () => {
      mockRedisClient.eval.mockResolvedValue(0);
      mockRedisClient.get.mockResolvedValue(null); // No lock exists

      const result = await releaseLock('our-id');

      expect(result.released).toBe(false);
      expect(result.message).toContain('not held');
    });

    it('should fail when no lock ID provided and none remembered', async () => {
      // Need to reimport module to clear internal state
      vi.resetModules();

      // Re-mock after reset
      vi.mock('@/lib/redis/client', () => ({
        getRedisClient: vi.fn(() => mockRedisClient),
      }));

      const { releaseLock: freshReleaseLock } = await import('@/lib/redis/cron-lock');

      const result = await freshReleaseLock();

      expect(result.released).toBe(false);
      expect(result.message).toContain('No lock holder ID provided');
    });

    it('should handle Redis error gracefully during release', async () => {
      // Acquire lock first
      mockRedisClient.set.mockResolvedValue('OK');
      await acquireLock('test-id');

      // Release fails due to Redis error
      mockRedisClient.eval.mockRejectedValue(new Error('Redis connection failed'));

      const result = await releaseLock('test-id');

      expect(result.released).toBe(false);
      expect(result.message).toContain('Redis error');
    });

    it('should use correct Lua script pattern for conditional release', async () => {
      mockRedisClient.set.mockResolvedValue('OK');
      await acquireLock('test-id');

      mockRedisClient.eval.mockResolvedValue(1);

      await releaseLock('test-id');

      // Verify Lua script is passed correctly
      const luaScript = mockRedisClient.eval.mock.calls[0][0] as string;
      expect(luaScript).toContain('GET');
      expect(luaScript).toContain('DEL');
      expect(luaScript).toContain('expectedHolder');
    });
  });

  describe('getStatus', () => {
    it('should return unlocked status when no lock exists', async () => {
      mockRedisClient.get
        .mockResolvedValueOnce(null) // lock key
        .mockResolvedValueOnce(null); // metadata key
      mockRedisClient.pttl.mockResolvedValue(-2); // Key does not exist

      const result = await getStatus();

      expect(result.locked).toBe(false);
      expect(result.lockHolder).toBeNull();
      expect(result.lockAcquiredAt).toBeNull();
      expect(result.expiresAt).toBeNull();
    });

    it('should return locked status with holder info when lock exists', async () => {
      const acquiredAt = Date.now() - 60000;
      mockRedisClient.get
        .mockResolvedValueOnce('lock-holder-123') // lock key
        .mockResolvedValueOnce(JSON.stringify({ lockAcquiredAt: acquiredAt })); // metadata
      mockRedisClient.pttl.mockResolvedValue(1440000); // 24 minutes remaining

      const result = await getStatus();

      expect(result.locked).toBe(true);
      expect(result.lockHolder).toBe('lock-holder-123');
      expect(result.lockAcquiredAt).toBe(acquiredAt);
      expect(result.timeHeldMs).toBe(60000);
      expect(result.expiresAt).toBe(Date.now() + 1440000);
    });

    it('should handle missing metadata gracefully', async () => {
      mockRedisClient.get
        .mockResolvedValueOnce('lock-holder-123') // lock key
        .mockResolvedValueOnce(null); // no metadata
      mockRedisClient.pttl.mockResolvedValue(1440000);

      const result = await getStatus();

      expect(result.locked).toBe(true);
      expect(result.lockHolder).toBe('lock-holder-123');
      expect(result.lockAcquiredAt).toBeNull();
      expect(result.timeHeldMs).toBeNull();
    });

    it('should handle invalid metadata JSON gracefully', async () => {
      mockRedisClient.get
        .mockResolvedValueOnce('lock-holder-123')
        .mockResolvedValueOnce('invalid-json');
      mockRedisClient.pttl.mockResolvedValue(1440000);

      const result = await getStatus();

      expect(result.locked).toBe(true);
      expect(result.lockHolder).toBe('lock-holder-123');
      expect(result.lockAcquiredAt).toBeNull();
    });

    it('should use custom lock name when provided', async () => {
      mockRedisClient.get.mockResolvedValue(null);
      mockRedisClient.pttl.mockResolvedValue(-2);

      await getStatus('custom-lock');

      expect(mockRedisClient.get).toHaveBeenCalledWith('cron-lock:custom-lock');
    });

    it('should handle Redis error gracefully', async () => {
      mockRedisClient.get.mockRejectedValue(new Error('Redis connection failed'));

      const result = await getStatus();

      // Should return unlocked state on error
      expect(result.locked).toBe(false);
      expect(result.lockHolder).toBeNull();
    });

    it('should calculate correct expiresAt when TTL is positive', async () => {
      const now = Date.now();
      mockRedisClient.get.mockResolvedValueOnce('holder').mockResolvedValueOnce(null);
      mockRedisClient.pttl.mockResolvedValue(300000); // 5 minutes

      const result = await getStatus();

      expect(result.expiresAt).toBe(now + 300000);
    });

    it('should return null expiresAt when TTL is negative', async () => {
      mockRedisClient.get.mockResolvedValueOnce('holder').mockResolvedValueOnce(null);
      mockRedisClient.pttl.mockResolvedValue(-1); // No TTL set

      const result = await getStatus();

      expect(result.expiresAt).toBeNull();
    });
  });

  describe('forceRelease', () => {
    it('should unconditionally delete lock and metadata', async () => {
      mockRedisClient.del.mockResolvedValue(1);

      await forceRelease();

      expect(mockRedisClient.del).toHaveBeenCalledWith('cron-lock:class-check-cron');
      expect(mockRedisClient.del).toHaveBeenCalledWith('cron-lock:class-check-cron:meta');
    });

    it('should work with custom lock name', async () => {
      mockRedisClient.del.mockResolvedValue(1);

      await forceRelease('custom-lock');

      expect(mockRedisClient.del).toHaveBeenCalledWith('cron-lock:custom-lock');
      expect(mockRedisClient.del).toHaveBeenCalledWith('cron-lock:custom-lock:meta');
    });

    it('should work even when no lock exists', async () => {
      mockRedisClient.del.mockResolvedValue(0); // No key deleted

      await forceRelease();

      // Should complete without error
      expect(mockRedisClient.del).toHaveBeenCalled();
    });

    it('should throw error on Redis failure', async () => {
      mockRedisClient.del.mockRejectedValue(new Error('Redis connection failed'));

      await expect(forceRelease()).rejects.toThrow('Redis connection failed');
    });
  });

  describe('lock auto-expiry behavior', () => {
    it('should set 25-minute TTL on lock acquisition', async () => {
      mockRedisClient.set.mockResolvedValue('OK');

      await acquireLock('test-id');

      expect(mockRedisClient.set).toHaveBeenCalledWith(
        'cron-lock:class-check-cron',
        'test-id',
        'PX',
        25 * 60 * 1000, // 25 minutes in milliseconds
        'NX'
      );
    });

    it('should set same TTL on metadata', async () => {
      mockRedisClient.set.mockResolvedValue('OK');

      await acquireLock('test-id');

      // Second call is metadata
      expect(mockRedisClient.set).toHaveBeenLastCalledWith(
        'cron-lock:class-check-cron:meta',
        expect.any(String),
        'PX',
        25 * 60 * 1000
      );
    });
  });

  describe('concurrent acquisition scenarios', () => {
    it('should prevent second acquisition when first holds lock', async () => {
      // First acquisition succeeds
      mockRedisClient.set.mockResolvedValue('OK');
      const first = await acquireLock('first-holder');
      expect(first.acquired).toBe(true);

      // Second acquisition fails because lock exists
      mockRedisClient.set.mockResolvedValue(null); // NX fails
      mockRedisClient.get.mockResolvedValue('first-holder');
      mockRedisClient.pttl.mockResolvedValue(1440000);

      const second = await acquireLock('second-holder');

      expect(second.acquired).toBe(false);
      expect(second.lockHolder).toBe('first-holder');
    });

    it('should report time remaining when lock denied', async () => {
      mockRedisClient.set.mockResolvedValue(null);
      mockRedisClient.get.mockResolvedValueOnce('holder').mockResolvedValueOnce(null);
      mockRedisClient.pttl.mockResolvedValue(600000); // 10 minutes

      const result = await acquireLock('new-holder');

      expect(result.message).toContain('Time remaining: 600s');
    });
  });

  describe('edge cases', () => {
    it('should handle empty lock holder response gracefully', async () => {
      mockRedisClient.set.mockResolvedValue(null);
      mockRedisClient.get.mockResolvedValue(null); // Lock expired between check
      mockRedisClient.pttl.mockResolvedValue(-2);

      const result = await acquireLock('test-id');

      expect(result.acquired).toBe(false);
      expect(result.lockHolder).toBeUndefined();
    });

    it('should clear internal lock ID on release error', async () => {
      // Acquire lock
      mockRedisClient.set.mockResolvedValue('OK');
      await acquireLock('test-id');

      // Release fails
      mockRedisClient.eval.mockRejectedValue(new Error('Redis error'));
      await releaseLock('test-id');

      // Subsequent release without ID should fail gracefully
      vi.resetModules();
      vi.mock('@/lib/redis/client', () => ({
        getRedisClient: vi.fn(() => mockRedisClient),
      }));
      const { releaseLock: freshRelease } = await import('@/lib/redis/cron-lock');

      const result = await freshRelease();
      expect(result.released).toBe(false);
    });
  });
});
