/**
 * Redis-based Distributed Cron Lock
 *
 * Provides distributed locking for cron job coordination using Redis.
 * Ensures only one cron job can run at a time across all processes/servers.
 *
 * Features:
 * - Atomic lock acquisition with SET NX PX
 * - Atomic conditional release with Lua script (only release if we hold it)
 * - Auto-expiry after 25 minutes (safety margin before 30-min cron)
 * - Unique lock holder ID for debugging
 *
 * Based on CronLockDO from worker.ts.
 */

import { getRedisClient } from './client';

/**
 * Lock status information
 */
export interface LockStatus {
  locked: boolean;
  lockHolder: string | null;
  lockAcquiredAt: number | null;
  timeHeldMs: number | null;
  expiresAt: number | null;
}

/**
 * Result from lock acquisition attempt
 */
export interface AcquireLockResult {
  acquired: boolean;
  message: string;
  lockHolder?: string;
  lockedSince?: number;
}

/**
 * Result from lock release attempt
 */
export interface ReleaseLockResult {
  released: boolean;
  message: string;
}

// Lock configuration
const LOCK_TIMEOUT_MS = 25 * 60 * 1000; // 25 minutes
const DEFAULT_LOCK_NAME = 'class-check-cron';

/**
 * Generate a unique lock holder ID
 *
 * Combines timestamp with random string for uniqueness
 */
function generateLockId(): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 10);
  return `${timestamp}-${random}`;
}

/**
 * Get the Redis key for a given lock name
 */
function getLockKey(name: string): string {
  return `cron-lock:${name}`;
}

/**
 * Get the metadata key for storing lock info
 */
function getMetadataKey(name: string): string {
  return `cron-lock:${name}:meta`;
}

/**
 * Attempt to acquire the cron lock
 *
 * Uses Redis SET NX PX for atomic acquisition with TTL.
 * Lock auto-expires after 25 minutes if not released.
 *
 * @param lockId - Optional custom lock holder ID (auto-generated if not provided)
 * @param name - Lock name (default: 'class-check-cron')
 * @returns Object with acquisition result
 *
 * @example
 * const result = await acquireLock();
 * if (result.acquired) {
 *   try {
 *     // ... cron processing
 *   } finally {
 *     await releaseLock();
 *   }
 * }
 */
export async function acquireLock(
  lockId?: string,
  name: string = DEFAULT_LOCK_NAME
): Promise<AcquireLockResult> {
  try {
    const redis = getRedisClient();
    const lockKey = getLockKey(name);
    const metadataKey = getMetadataKey(name);
    const holderId = lockId || generateLockId();

    // Atomic lock acquisition: SET key value NX PX timeout
    // NX = only set if not exists, PX = timeout in milliseconds
    const acquired = await redis.set(lockKey, holderId, 'PX', LOCK_TIMEOUT_MS, 'NX');

    if (acquired === 'OK') {
      // Store metadata for status queries
      const acquiredAt = Date.now();
      try {
        await redis.set(
          metadataKey,
          JSON.stringify({
            lockHolder: holderId,
            lockAcquiredAt: acquiredAt,
          }),
          'PX',
          LOCK_TIMEOUT_MS
        );
      } catch (metaError) {
        // Log but don't fail - metadata is not critical
        const errorMsg = metaError instanceof Error ? metaError.message : 'Unknown error';
        console.warn(`[CronLock] Failed to store metadata: ${errorMsg}`);
      }

      console.log(`[CronLock] Lock acquired by ${holderId}`);

      return {
        acquired: true,
        message: 'Lock acquired successfully',
        lockHolder: holderId,
        lockedSince: acquiredAt,
      };
    }

    // Lock already held by someone else
    const existingHolder = await redis.get(lockKey);
    const metadataRaw = await redis.get(metadataKey);

    let lockedSince: number | undefined;
    if (metadataRaw) {
      try {
        const metadata = JSON.parse(metadataRaw) as { lockAcquiredAt?: number };
        lockedSince = metadata.lockAcquiredAt;
      } catch {
        // Ignore parse errors
      }
    }

    const timeHeld = lockedSince ? Date.now() - lockedSince : 0;
    const ttl = await redis.pttl(lockKey);

    console.log(
      `[CronLock] Lock acquisition denied - already held by ${existingHolder} for ${Math.floor(timeHeld / 1000)}s`
    );

    return {
      acquired: false,
      message: `Cron lock already held by ${existingHolder}. Time remaining: ${Math.ceil(ttl / 1000)}s`,
      lockHolder: existingHolder || undefined,
      lockedSince,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[CronLock] Error acquiring lock for ${name}: ${errorMsg}`);
    return {
      acquired: false,
      message: `Failed to acquire lock due to Redis error: ${errorMsg}`,
    };
  }
}

/**
 * Lua script for atomic conditional release
 *
 * Only releases the lock if the current value matches the expected holder ID.
 * This prevents accidentally releasing a lock we no longer hold (e.g., after expiry).
 */
const RELEASE_SCRIPT = `
local key = KEYS[1]
local metaKey = KEYS[2]
local expectedHolder = ARGV[1]

local currentHolder = redis.call('GET', key)
if currentHolder == expectedHolder then
  redis.call('DEL', key)
  redis.call('DEL', metaKey)
  return 1
else
  return 0
end
`;

/**
 * Release the cron lock
 *
 * Uses Lua script for atomic conditional release.
 * Only releases if we currently hold the lock.
 *
 * @param lockId - Lock holder ID (required)
 * @param name - Lock name (default: 'class-check-cron')
 * @returns Object with release result
 */
export async function releaseLock(
  lockId: string,
  name: string = DEFAULT_LOCK_NAME
): Promise<ReleaseLockResult> {
  const holderId = lockId;

  if (!holderId) {
    return {
      released: false,
      message: 'Lock holder ID is required',
    };
  }

  try {
    const redis = getRedisClient();
    const lockKey = getLockKey(name);
    const metadataKey = getMetadataKey(name);

    // Atomic conditional release using Lua script
    const result = await redis.eval(RELEASE_SCRIPT, 2, lockKey, metadataKey, holderId);

    if (result === 1) {
      console.log(`[CronLock] Lock released by ${holderId}`);
      return {
        released: true,
        message: 'Lock released successfully',
      };
    }

    // Lock not held or held by different holder
    const currentHolder = await redis.get(lockKey);

    if (!currentHolder) {
      console.log(`[CronLock] Release attempted by ${holderId}, but lock not held (expired?)`);
      return {
        released: false,
        message: 'Lock was not held (may have expired)',
      };
    }

    console.warn(
      `[CronLock] Release denied - lock held by ${currentHolder}, requested by ${holderId}`
    );
    return {
      released: false,
      message: `Lock held by different holder (${currentHolder})`,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[CronLock] Error releasing lock ${name} for ${holderId}: ${errorMsg}`);
    return {
      released: false,
      message: `Failed to release lock due to Redis error: ${errorMsg}`,
    };
  }
}

/**
 * Get current lock status
 *
 * @param name - Lock name (default: 'class-check-cron')
 * @returns Lock status information
 */
export async function getStatus(name: string = DEFAULT_LOCK_NAME): Promise<LockStatus> {
  try {
    const redis = getRedisClient();
    const lockKey = getLockKey(name);
    const metadataKey = getMetadataKey(name);

    const [lockHolder, metadataRaw, ttl] = await Promise.all([
      redis.get(lockKey),
      redis.get(metadataKey),
      redis.pttl(lockKey),
    ]);

    if (!lockHolder) {
      return {
        locked: false,
        lockHolder: null,
        lockAcquiredAt: null,
        timeHeldMs: null,
        expiresAt: null,
      };
    }

    let lockAcquiredAt: number | null = null;
    if (metadataRaw) {
      try {
        const metadata = JSON.parse(metadataRaw) as { lockAcquiredAt?: number };
        lockAcquiredAt = metadata.lockAcquiredAt || null;
      } catch {
        // Ignore parse errors
      }
    }

    const timeHeldMs = lockAcquiredAt ? Date.now() - lockAcquiredAt : null;
    const expiresAt = ttl > 0 ? Date.now() + ttl : null;

    return {
      locked: true,
      lockHolder,
      lockAcquiredAt,
      timeHeldMs,
      expiresAt,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[CronLock] Error getting status for ${name}: ${errorMsg}`);
    // Return unlocked state on error
    return {
      locked: false,
      lockHolder: null,
      lockAcquiredAt: null,
      timeHeldMs: null,
      expiresAt: null,
    };
  }
}

/**
 * Force release the lock unconditionally
 *
 * For admin/testing purposes only. Use when lock is stuck.
 *
 * @param name - Lock name (default: 'class-check-cron')
 */
export async function forceRelease(name: string = DEFAULT_LOCK_NAME): Promise<void> {
  try {
    const redis = getRedisClient();
    const lockKey = getLockKey(name);
    const metadataKey = getMetadataKey(name);

    console.log(`[CronLock] Force release requested for ${name}`);

    await Promise.all([redis.del(lockKey), redis.del(metadataKey)]);

    console.log(`[CronLock] Lock forcefully released`);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[CronLock] Error force releasing lock ${name}: ${errorMsg}`);
    throw error; // Re-throw for admin operations
  }
}
