/**
 * Redis Client Singleton
 *
 * Provides a singleton Redis connection using ioredis.
 * Supports both Upstash Redis (TLS via rediss://) and local Redis.
 *
 * Configuration via REDIS_URL environment variable:
 * - Upstash: rediss://default:password@host.upstash.io:6379
 * - Local: redis://localhost:6379
 */

import Redis from 'ioredis';

let redisClient: Redis | null = null;
let bullmqConnection: Redis | null = null;

/**
 * Get or create the Redis client singleton
 *
 * Uses lazy initialization - connection is only established on first call.
 * Subsequent calls return the same instance.
 *
 * @returns Redis client instance
 * @throws Error if REDIS_URL is not configured
 *
 * @example
 * const redis = getRedisClient();
 * await redis.set('key', 'value');
 * const value = await redis.get('key');
 */
export function getRedisClient(): Redis {
  if (redisClient) {
    return redisClient;
  }

  const redisUrl = process.env.REDIS_URL;

  if (!redisUrl) {
    throw new Error(
      'REDIS_URL is not set in environment variables. ' +
        'Expected format: redis://user:pass@host:port or rediss://... for TLS'
    );
  }

  // Parse the URL to detect TLS requirement
  const isTls = redisUrl.startsWith('rediss://');

  redisClient = new Redis(redisUrl, {
    // Enable TLS for Upstash (rediss:// URLs)
    tls: isTls ? {} : undefined,
    // Retry strategy with exponential backoff
    retryStrategy: (times: number) => {
      if (times > 10) {
        console.error('[Redis] Max retries reached, giving up');
        return null; // Stop retrying
      }
      const delay = Math.min(times * 100, 3000);
      console.log(`[Redis] Retrying connection in ${delay}ms (attempt ${times})`);
      return delay;
    },
    // Connection settings
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    lazyConnect: false,
  });

  // Connection event handlers
  redisClient.on('connect', () => {
    console.log('[Redis] Connected to Redis server');
  });

  redisClient.on('ready', () => {
    console.log('[Redis] Client ready, accepting commands');
  });

  redisClient.on('error', (err: Error) => {
    console.error('[Redis] Connection error:', err.message);
  });

  redisClient.on('close', () => {
    console.log('[Redis] Connection closed');
  });

  redisClient.on('reconnecting', () => {
    console.log('[Redis] Reconnecting...');
  });

  return redisClient;
}

/**
 * Get or create the BullMQ-specific Redis connection singleton
 *
 * BullMQ requires `maxRetriesPerRequest: null` for blocking operations.
 * This connection is dedicated to BullMQ Queue and Worker instances.
 *
 * @returns Redis client instance configured for BullMQ
 * @throws Error if REDIS_URL is not configured
 */
export function getBullMQConnection(): Redis {
  if (bullmqConnection) {
    return bullmqConnection;
  }

  const redisUrl = process.env.REDIS_URL;

  if (!redisUrl) {
    throw new Error(
      'REDIS_URL is not set in environment variables. ' +
        'Expected format: redis://user:pass@host:port or rediss://... for TLS'
    );
  }

  const isTls = redisUrl.startsWith('rediss://');

  bullmqConnection = new Redis(redisUrl, {
    tls: isTls ? {} : undefined,
    retryStrategy: (times: number) => {
      if (times > 10) {
        console.error('[Redis:BullMQ] Max retries reached, giving up');
        return null;
      }
      const delay = Math.min(times * 100, 3000);
      console.log(`[Redis:BullMQ] Retrying connection in ${delay}ms (attempt ${times})`);
      return delay;
    },
    maxRetriesPerRequest: null, // REQUIRED for BullMQ blocking operations
    enableReadyCheck: true,
    lazyConnect: false,
  });

  bullmqConnection.on('connect', () => {
    console.log('[Redis:BullMQ] Connected to Redis server');
  });

  bullmqConnection.on('ready', () => {
    console.log('[Redis:BullMQ] Client ready, accepting commands');
  });

  bullmqConnection.on('error', (err: Error) => {
    console.error('[Redis:BullMQ] Connection error:', err.message);
  });

  bullmqConnection.on('close', () => {
    console.log('[Redis:BullMQ] Connection closed');
  });

  bullmqConnection.on('reconnecting', () => {
    console.log('[Redis:BullMQ] Reconnecting...');
  });

  return bullmqConnection;
}

/**
 * Close all Redis connections gracefully
 *
 * Should be called during application shutdown to ensure clean disconnection.
 * Closes both the general Redis client and BullMQ-specific connection.
 * Resets the singletons so new connections can be established if needed.
 *
 * @example
 * // In shutdown handler
 * process.on('SIGTERM', async () => {
 *   await closeRedisConnection();
 *   process.exit(0);
 * });
 */
export async function closeRedisConnection(): Promise<void> {
  const closePromises: Promise<void>[] = [];

  if (redisClient) {
    closePromises.push(
      (async () => {
        try {
          console.log('[Redis] Closing connection...');
          await redisClient!.quit();
          console.log('[Redis] Connection closed gracefully');
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : 'Unknown error';
          console.error(`[Redis] Error closing connection: ${errorMsg}`);
          try {
            redisClient!.disconnect();
          } catch {
            // Ignore disconnect errors
          }
        } finally {
          redisClient = null;
        }
      })()
    );
  }

  if (bullmqConnection) {
    closePromises.push(
      (async () => {
        try {
          console.log('[Redis:BullMQ] Closing connection...');
          await bullmqConnection!.quit();
          console.log('[Redis:BullMQ] Connection closed gracefully');
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : 'Unknown error';
          console.error(`[Redis:BullMQ] Error closing connection: ${errorMsg}`);
          try {
            bullmqConnection!.disconnect();
          } catch {
            // Ignore disconnect errors
          }
        } finally {
          bullmqConnection = null;
        }
      })()
    );
  }

  await Promise.all(closePromises);
}

/**
 * Check if Redis connection is currently active
 *
 * @returns true if connected and ready
 */
export function isRedisConnected(): boolean {
  return redisClient?.status === 'ready';
}
