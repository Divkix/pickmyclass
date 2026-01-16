/**
 * System Health and Monitoring Endpoint
 *
 * Provides real-time system status including Redis, queue, circuit breaker,
 * cron scheduler, and database status.
 */

import { NextResponse } from 'next/server';
import { getSchedulerStatus } from '@/lib/cron/scheduler';
import { getQueueStats } from '@/lib/queue/queues';
import { getCircuitBreaker } from '@/lib/redis/circuit-breaker';
import { isRedisConnected } from '@/lib/redis/client';
import { getStatus as getCronLockStatus } from '@/lib/redis/cron-lock';
import { getServiceClient } from '@/lib/supabase/service';

/**
 * Health status response
 */
interface HealthStatus {
  timestamp: string;
  status: 'healthy' | 'degraded' | 'unhealthy';
  checks: Record<string, unknown>;
  response_time_ms?: number;
}

/**
 * GET /api/monitoring/health
 *
 * Returns system health status for monitoring and alerting
 * Public endpoint - no authentication required
 */
export async function GET() {
  const startTime = Date.now();
  const health: HealthStatus = {
    timestamp: new Date().toISOString(),
    status: 'healthy',
    checks: {},
  };

  // 1. Check Redis Connection
  try {
    const redisConnected = isRedisConnected();
    health.checks.redis = {
      status: redisConnected ? 'healthy' : 'unhealthy',
      connected: redisConnected,
    };

    if (!redisConnected) {
      health.status = 'unhealthy';
    }
  } catch (error) {
    health.checks.redis = {
      status: 'unhealthy',
      error: error instanceof Error ? error.message : 'Unknown error',
    };
    health.status = 'unhealthy';
  }

  // 2. Check Database Connection
  try {
    const supabase = getServiceClient();
    const { error } = await supabase.from('class_watches').select('id').limit(1);

    if (error) {
      health.checks.database = {
        status: 'unhealthy',
        error: error.message,
      };
      health.status = 'degraded';
    } else {
      health.checks.database = {
        status: 'healthy',
        latency_ms: Date.now() - startTime,
      };
    }
  } catch (error) {
    health.checks.database = {
      status: 'unhealthy',
      error: error instanceof Error ? error.message : 'Unknown error',
    };
    health.status = 'unhealthy';
  }

  // 3. Check Queue Metrics
  try {
    const queueStats = await getQueueStats();

    health.checks.queue = {
      status: 'healthy',
      type: 'bullmq',
      waiting: queueStats.waiting,
      active: queueStats.active,
      completed: queueStats.completed,
      failed: queueStats.failed,
      delayed: queueStats.delayed,
      paused: queueStats.paused,
    };
  } catch (error) {
    health.checks.queue = {
      status: 'unhealthy',
      type: 'bullmq',
      error: error instanceof Error ? error.message : 'Unknown error',
    };
    health.status = 'degraded';
  }

  // 4. Check Circuit Breaker Status
  try {
    const circuitBreaker = getCircuitBreaker();
    const cbStatus = await circuitBreaker.getStatus();

    health.checks.circuit_breaker = {
      status:
        cbStatus.state === 'CLOSED'
          ? 'healthy'
          : cbStatus.state === 'HALF_OPEN'
            ? 'degraded'
            : 'unhealthy',
      type: 'redis',
      state: cbStatus.state,
      failure_count: cbStatus.failureCount,
      success_count: cbStatus.successCount,
      last_failure: cbStatus.lastFailureTime
        ? new Date(cbStatus.lastFailureTime).toISOString()
        : null,
      last_state_change: new Date(cbStatus.lastStateChange).toISOString(),
    };

    if (cbStatus.state === 'OPEN') {
      health.status = 'degraded';
    }
  } catch (error) {
    health.checks.circuit_breaker = {
      status: 'unhealthy',
      type: 'redis',
      error: error instanceof Error ? error.message : 'Unknown error',
    };
    health.status = 'degraded';
  }

  // 5. Check Cron Lock Status
  try {
    const lockStatus = await getCronLockStatus();

    health.checks.cron_lock = {
      status: 'healthy',
      type: 'redis',
      locked: lockStatus.locked,
      lock_holder: lockStatus.lockHolder,
      time_held_ms: lockStatus.timeHeldMs,
      lock_acquired_at: lockStatus.lockAcquiredAt
        ? new Date(lockStatus.lockAcquiredAt).toISOString()
        : null,
      expires_at: lockStatus.expiresAt ? new Date(lockStatus.expiresAt).toISOString() : null,
    };
  } catch (error) {
    health.checks.cron_lock = {
      status: 'unhealthy',
      type: 'redis',
      error: error instanceof Error ? error.message : 'Unknown error',
    };
    health.status = 'degraded';
  }

  // 6. Check Scheduler Status
  try {
    const schedulerStatus = getSchedulerStatus();

    health.checks.scheduler = {
      status: schedulerStatus.running ? 'healthy' : 'not_running',
      type: 'node-cron',
      running: schedulerStatus.running,
      schedule: schedulerStatus.schedule,
      timezone: schedulerStatus.timezone,
    };
  } catch (error) {
    health.checks.scheduler = {
      status: 'unhealthy',
      type: 'node-cron',
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }

  // 7. Check Environment Configuration
  const requiredEnvVars = [
    'NEXT_PUBLIC_SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
    'SCRAPER_URL',
    'SCRAPER_SECRET_TOKEN',
    'CRON_SECRET',
    'REDIS_URL',
  ];

  const missingEnvVars = requiredEnvVars.filter((key) => !process.env[key]);

  health.checks.configuration = {
    status: missingEnvVars.length === 0 ? 'healthy' : 'unhealthy',
    missing_vars: missingEnvVars.length > 0 ? missingEnvVars : undefined,
  };

  if (missingEnvVars.length > 0) {
    health.status = 'unhealthy';
  }

  // 8. Check Optional Services
  health.checks.email = {
    status: process.env.RESEND_API_KEY ? 'healthy' : 'not_configured',
    configured: !!process.env.RESEND_API_KEY,
  };

  // 9. Overall Response Time
  health.response_time_ms = Date.now() - startTime;

  // Return appropriate status code
  const statusCode = health.status === 'healthy' ? 200 : health.status === 'degraded' ? 503 : 500;

  return NextResponse.json(health, { status: statusCode });
}
