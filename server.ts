/**
 * Unified Server Entry Point
 *
 * Main entry point for the VPS deployment. Starts:
 * 1. Next.js server (custom server mode)
 * 2. Redis connection
 * 3. Cron scheduler for periodic class checks
 * 4. BullMQ worker for queue processing
 *
 * Handles graceful shutdown on SIGTERM/SIGINT.
 */

import { createServer } from 'node:http';
import next from 'next';
import { startScheduler, stopScheduler } from './lib/cron/scheduler';
import { closeQueues } from './lib/queue/queues';
import { startWorker, stopWorker } from './lib/queue/worker';
import { closeRedisConnection, getRedisClient } from './lib/redis/client';

const port = Number.parseInt(process.env.PORT || '3000', 10);
const dev = process.env.NODE_ENV !== 'production';

// Track shutdown state to prevent double shutdown
let isShuttingDown = false;

// Shutdown timeout in milliseconds (30 seconds)
const SHUTDOWN_TIMEOUT_MS = 30_000;

/**
 * Graceful shutdown handler
 *
 * Stops all services in reverse order of startup:
 * 1. Stop accepting new connections
 * 2. Stop cron scheduler (no new jobs)
 * 3. Stop worker (wait for current jobs)
 * 4. Close queues
 * 5. Close Redis connection
 *
 * Includes a 30-second timeout to force exit if shutdown hangs.
 */
async function gracefulShutdown(
  signal: string,
  server: ReturnType<typeof createServer>
): Promise<void> {
  if (isShuttingDown) {
    console.log(`[Server] Already shutting down, ignoring ${signal}`);
    return;
  }

  isShuttingDown = true;
  console.log(`\n[Server] Received ${signal}, starting graceful shutdown...`);
  console.log(`[Server] Shutdown timeout: ${SHUTDOWN_TIMEOUT_MS / 1000} seconds`);

  const shutdownStart = Date.now();

  // Set up forced shutdown timeout
  const forceExitTimer = setTimeout(() => {
    const elapsed = Date.now() - shutdownStart;
    console.error(`[Server] Shutdown timeout exceeded (${elapsed}ms), forcing exit...`);
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);

  // Ensure the timer doesn't prevent the process from exiting naturally
  forceExitTimer.unref();

  try {
    // Step 1: Stop HTTP server (stop accepting new connections)
    console.log('[Server] Step 1/5: Closing HTTP server...');
    await new Promise<void>((resolve, reject) => {
      server.close((err) => {
        if (err) {
          console.error('[Server] Error closing HTTP server:', err);
          reject(err);
        } else {
          console.log('[Server] HTTP server closed');
          resolve();
        }
      });
    });

    // Step 2: Stop cron scheduler (prevent new jobs from being enqueued)
    console.log('[Server] Step 2/5: Stopping cron scheduler...');
    stopScheduler();
    console.log('[Server] Cron scheduler stopped');

    // Step 3: Stop worker (waits for current jobs to complete)
    console.log('[Server] Step 3/5: Stopping queue worker...');
    await stopWorker();
    console.log('[Server] Queue worker stopped');

    // Step 4: Close queue connections
    console.log('[Server] Step 4/5: Closing queue connections...');
    await closeQueues();
    console.log('[Server] Queue connections closed');

    // Step 5: Close Redis connection
    console.log('[Server] Step 5/5: Closing Redis connection...');
    await closeRedisConnection();
    console.log('[Server] Redis connection closed');

    // Clear the forced shutdown timer since we completed successfully
    clearTimeout(forceExitTimer);

    const duration = Date.now() - shutdownStart;
    console.log('[Server] ----------------------------------------');
    console.log(`[Server] Graceful shutdown completed in ${duration}ms`);
    console.log('[Server] ========================================');
    process.exit(0);
  } catch (error) {
    clearTimeout(forceExitTimer);
    const duration = Date.now() - shutdownStart;
    console.error(`[Server] Error during shutdown after ${duration}ms:`, error);
    process.exit(1);
  }
}

/**
 * Main server startup
 */
async function main(): Promise<void> {
  console.log('[Server] ========================================');
  console.log('[Server] PickMyClass VPS Server Starting...');
  console.log('[Server] ========================================');
  console.log(`[Server] Environment: ${dev ? 'development' : 'production'}`);
  console.log(`[Server] Port: ${port}`);
  console.log(`[Server] Node.js: ${process.version}`);
  console.log('[Server] ----------------------------------------');

  const startupStart = Date.now();

  try {
    // Step 1: Initialize Redis connection
    console.log('[Server] Initializing Redis connection...');
    const redis = getRedisClient();

    // Verify connection with a ping
    await redis.ping();
    console.log('[Server] Redis connection established');

    // Step 2: Initialize Next.js
    console.log('[Server] Initializing Next.js...');
    const app = next({ dev });
    const handle = app.getRequestHandler();

    await app.prepare();
    console.log('[Server] Next.js ready');

    // Step 3: Create HTTP server
    const server = createServer((req, res) => {
      handle(req, res);
    });

    // Step 4: Start listening
    await new Promise<void>((resolve) => {
      server.listen(port, () => {
        console.log(`[Server] HTTP server listening on port ${port}`);
        resolve();
      });
    });

    // Step 5: Start cron scheduler
    console.log('[Server] Starting cron scheduler...');
    startScheduler();

    // Step 6: Start queue worker
    console.log('[Server] Starting queue worker...');
    startWorker();

    // Calculate startup time
    const startupDuration = Date.now() - startupStart;
    console.log('[Server] ----------------------------------------');
    console.log(`[Server] All services started in ${startupDuration}ms`);
    console.log('[Server] ========================================');
    console.log(`[Server] Server ready at http://localhost:${port}`);
    console.log('[Server] ========================================');

    // Set up signal handlers for graceful shutdown
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM', server));
    process.on('SIGINT', () => gracefulShutdown('SIGINT', server));

    // Handle uncaught errors
    process.on('uncaughtException', (error) => {
      console.error('[Server] Uncaught exception:', error);
      gracefulShutdown('uncaughtException', server);
    });

    process.on('unhandledRejection', (reason) => {
      console.error('[Server] Unhandled rejection:', reason);
      // Don't shutdown on unhandled rejection, just log
    });
  } catch (error) {
    console.error('[Server] Fatal error during startup:', error);
    process.exit(1);
  }
}

// Start the server
main();
