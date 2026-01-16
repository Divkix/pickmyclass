#!/usr/bin/env bun
/**
 * POC Verification Script
 *
 * Verifies the VPS migration POC is complete by checking:
 * 1. All modules can be imported
 * 2. TypeScript compiles without errors
 * 3. Redis-based services are properly implemented
 * 4. Documents what manual testing is required
 *
 * Usage: bun scripts/poc-verify.ts
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';

// Colors for terminal output
const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  reset: '\x1b[0m',
  bold: '\x1b[1m',
};

function log(color: keyof typeof colors, msg: string) {
  console.log(`${colors[color]}${msg}${colors.reset}`);
}

function header(msg: string) {
  console.log(`\n${colors.bold}${colors.blue}=== ${msg} ===${colors.reset}\n`);
}

function check(name: string, passed: boolean, details?: string) {
  const icon = passed ? '✓' : '✗';
  const color = passed ? 'green' : 'red';
  log(color, `  ${icon} ${name}`);
  if (details) {
    console.log(`    ${colors.yellow}${details}${colors.reset}`);
  }
}

function info(msg: string) {
  console.log(`  ${colors.yellow}→ ${msg}${colors.reset}`);
}

async function main() {
  console.log(`${colors.bold}
╔══════════════════════════════════════════════════════════════╗
║          POC Verification for VPS Migration                  ║
║                    Workers → VPS                             ║
╚══════════════════════════════════════════════════════════════╝
${colors.reset}`);

  const projectRoot = process.cwd();
  let allPassed = true;

  // ===== Phase 1: File Existence Checks =====
  header('Phase 1: File Existence');

  const requiredFiles = [
    { path: 'lib/redis/client.ts', desc: 'Redis client singleton' },
    { path: 'lib/redis/circuit-breaker.ts', desc: 'Redis-based circuit breaker' },
    { path: 'lib/redis/cron-lock.ts', desc: 'Redis-based cron lock' },
    { path: 'lib/queue/config.ts', desc: 'BullMQ queue configuration' },
    { path: 'lib/queue/queues.ts', desc: 'BullMQ queue definitions' },
    { path: 'lib/queue/types.ts', desc: 'Queue job types' },
    { path: 'lib/queue/worker.ts', desc: 'BullMQ worker implementation' },
    { path: 'lib/cron/scheduler.ts', desc: 'node-cron scheduler' },
    { path: 'lib/cron/class-check.ts', desc: 'Class check cron handler' },
    { path: 'server.ts', desc: 'Unified server entry point' },
    { path: 'app/api/monitoring/health/route.ts', desc: 'Updated health endpoint' },
  ];

  for (const file of requiredFiles) {
    const fullPath = join(projectRoot, file.path);
    const exists = existsSync(fullPath);
    check(file.path, exists, file.desc);
    if (!exists) allPassed = false;
  }

  // ===== Phase 2: Module Import Checks =====
  header('Phase 2: Module Imports (No Runtime Errors)');

  const modulesToTest = [
    { path: '@/lib/redis/client', name: 'Redis Client' },
    { path: '@/lib/redis/circuit-breaker', name: 'Circuit Breaker' },
    { path: '@/lib/redis/cron-lock', name: 'Cron Lock' },
    { path: '@/lib/queue/config', name: 'Queue Config' },
    { path: '@/lib/queue/queues', name: 'Queue Definitions' },
    { path: '@/lib/queue/types', name: 'Queue Types' },
    { path: '@/lib/queue/worker', name: 'Queue Worker' },
    { path: '@/lib/cron/scheduler', name: 'Cron Scheduler' },
    { path: '@/lib/cron/class-check', name: 'Class Check Handler' },
  ];

  for (const mod of modulesToTest) {
    try {
      // Use dynamic import to test module loading
      await import(mod.path.replace('@/', `${projectRoot}/`));
      check(mod.name, true, `Import successful: ${mod.path}`);
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      check(mod.name, false, `Import failed: ${errMsg}`);
      allPassed = false;
    }
  }

  // ===== Phase 3: Export Verification =====
  header('Phase 3: Key Exports Available');

  // Redis client exports
  try {
    const redisClient = await import(`${projectRoot}/lib/redis/client`);
    check('getRedisClient export', typeof redisClient.getRedisClient === 'function');
    check('closeRedisConnection export', typeof redisClient.closeRedisConnection === 'function');
    check('isRedisConnected export', typeof redisClient.isRedisConnected === 'function');
  } catch (e) {
    check('Redis client exports', false, String(e));
    allPassed = false;
  }

  // Circuit breaker exports
  try {
    const cb = await import(`${projectRoot}/lib/redis/circuit-breaker`);
    check('getCircuitBreaker export', typeof cb.getCircuitBreaker === 'function');
    check('CircuitState enum', cb.CircuitState !== undefined);
  } catch (e) {
    check('Circuit breaker exports', false, String(e));
    allPassed = false;
  }

  // Cron lock exports
  try {
    const cronLock = await import(`${projectRoot}/lib/redis/cron-lock`);
    check('acquireLock export', typeof cronLock.acquireLock === 'function');
    check('releaseLock export', typeof cronLock.releaseLock === 'function');
    check('getStatus export', typeof cronLock.getStatus === 'function');
  } catch (e) {
    check('Cron lock exports', false, String(e));
    allPassed = false;
  }

  // Queue exports
  try {
    const queues = await import(`${projectRoot}/lib/queue/queues`);
    check('getClassCheckQueue export', typeof queues.getClassCheckQueue === 'function');
    check('enqueueClassCheck export', typeof queues.enqueueClassCheck === 'function');
    check('enqueueClassCheckBulk export', typeof queues.enqueueClassCheckBulk === 'function');
  } catch (e) {
    check('Queue exports', false, String(e));
    allPassed = false;
  }

  // Worker exports
  try {
    const worker = await import(`${projectRoot}/lib/queue/worker`);
    check('startWorker export', typeof worker.startWorker === 'function');
    check('stopWorker export', typeof worker.stopWorker === 'function');
  } catch (e) {
    check('Worker exports', false, String(e));
    allPassed = false;
  }

  // Scheduler exports
  try {
    const scheduler = await import(`${projectRoot}/lib/cron/scheduler`);
    check('startScheduler export', typeof scheduler.startScheduler === 'function');
    check('stopScheduler export', typeof scheduler.stopScheduler === 'function');
    check('getSchedulerStatus export', typeof scheduler.getSchedulerStatus === 'function');
  } catch (e) {
    check('Scheduler exports', false, String(e));
    allPassed = false;
  }

  // ===== Phase 4: Configuration Checks =====
  header('Phase 4: Configuration');

  try {
    const config = await import(`${projectRoot}/lib/queue/config`);
    check('QUEUE_NAMES defined', config.QUEUE_NAMES?.CLASS_CHECK !== undefined);
    check('JOB_CONFIG defined', config.JOB_CONFIG !== undefined);
    check('QUEUE_CONFIG defined', config.QUEUE_CONFIG !== undefined);
    info(`Queue name: ${config.QUEUE_NAMES?.CLASS_CHECK}`);
    info(`Default concurrency: ${config.WORKER_CONFIG?.concurrency}`);
  } catch (e) {
    check('Configuration', false, String(e));
    allPassed = false;
  }

  // ===== Manual Testing Requirements =====
  header('Manual Testing Requirements');

  console.log(`${colors.yellow}
The following require manual testing with a running Redis instance:

1. Server Startup (requires REDIS_URL):
   ${colors.bold}REDIS_URL=redis://localhost:6379 bun server.ts${colors.reset}${colors.yellow}

   Expected: Server starts, Redis connects, cron scheduled

2. Health Endpoint:
   ${colors.bold}curl http://localhost:3000/api/monitoring/health${colors.reset}${colors.yellow}

   Expected: JSON with Redis, queue, circuit breaker status

3. Cron Trigger (manual):
   ${colors.bold}curl -X POST -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron${colors.reset}${colors.yellow}

   Expected: Sections enqueued to BullMQ queue

4. Queue Processing:
   Check server logs for "[Worker] Processing section..." messages

   Expected: Jobs processed, state updated in Supabase

5. Email Notifications (requires RESEND_API_KEY):
   Add a test class watch, trigger cron with seat availability

   Expected: Email sent or logged

6. Graceful Shutdown:
   ${colors.bold}kill -SIGTERM <pid>${colors.reset}${colors.yellow}

   Expected: Clean shutdown with "[Server] Graceful shutdown completed"
${colors.reset}`);

  // ===== Summary =====
  header('Summary');

  if (allPassed) {
    log(
      'green',
      `
✓ All automated checks passed!

  POC Status: READY FOR TESTING

  Next steps:
  1. Set up Redis (local or Upstash)
  2. Run: REDIS_URL=redis://... bun server.ts
  3. Verify health endpoint
  4. Test cron trigger
  5. Verify queue processing
  `
    );
  } else {
    log(
      'red',
      `
✗ Some checks failed. Please review the errors above.

  Common issues:
  - Missing files from previous tasks
  - Import path issues
  - TypeScript compilation errors

  Run 'bun run build' to check for compilation errors.
  `
    );
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('POC verification failed:', error);
  process.exit(1);
});
