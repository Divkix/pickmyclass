/**
 * System Health and Monitoring Endpoint
 *
 * Provides real-time system status including ASU API, database, and cron lock.
 */

import { env } from 'cloudflare:workers';
import { NextResponse } from 'next/server';
import { fetchClassFromASU, NotFoundError } from '@/lib/asu/api';
import { TtlCache } from '@/lib/cache/ttl-cache';
import { getServiceClient } from '@/lib/supabase/service';
import { timingSafeCompare } from '@/lib/utils/crypto';

/**
 * Health status response
 */
interface HealthStatus {
  timestamp: string;
  status: 'healthy' | 'degraded' | 'unhealthy';
  checks: Record<string, unknown>;
  response_time_ms?: number;
}

const healthCache = new TtlCache<{ body: HealthStatus; statusCode: number }>(30_000);

/**
 * GET /api/monitoring/health
 *
 * Returns system health status for monitoring and alerting
 * Public endpoint - no authentication required
 */
export async function GET(request: Request) {
  // Auth check first - unauthenticated requests get a simple liveness probe
  // without running expensive DB/DO queries (prevents DoS via health endpoint)
  const authHeader = request.headers.get('authorization');
  const cfRecord = env as unknown as Record<string, string | undefined>;
  const cronSecret = process.env.CRON_SECRET || cfRecord.CRON_SECRET;
  const isAuthenticated =
    !!cronSecret && !!authHeader && timingSafeCompare(authHeader, `Bearer ${cronSecret}`);

  if (!isAuthenticated) {
    return NextResponse.json({ status: 'ok' }, { status: 200 });
  }

  const cached = healthCache.get('health');
  if (cached) {
    return NextResponse.json(cached.body, { status: cached.statusCode });
  }

  const startTime = Date.now();
  const health: HealthStatus = {
    timestamp: new Date().toISOString(),
    status: 'healthy',
    checks: {},
  };

  // Helper: only escalate health status, never downgrade
  const escalateStatus = (newStatus: 'degraded' | 'unhealthy') => {
    const precedence = { healthy: 0, degraded: 1, unhealthy: 2 } as const;
    if (precedence[newStatus] > precedence[health.status]) {
      health.status = newStatus;
    }
  };

  // 1. Check Database Connection
  try {
    const supabase = getServiceClient();
    const { error } = await supabase.from('class_watches').select('id').limit(1);

    if (error) {
      health.checks.database = {
        status: 'unhealthy',
        error: error.message,
      };
      escalateStatus('degraded');
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
    escalateStatus('unhealthy');
  }

  // 2. Check ASU API
  try {
    const asuEnv = env as unknown as { ASU_API_BASE_URL: string; ASU_API_TOKEN: string };
    await fetchClassFromASU('10001', '2251', asuEnv);
    health.checks.asu_api = {
      name: 'ASU API',
      status: 'healthy',
    };
  } catch (error) {
    // NotFoundError means the API is reachable but section doesn't exist - that's healthy
    if (error instanceof NotFoundError) {
      health.checks.asu_api = {
        name: 'ASU API',
        status: 'healthy',
      };
    } else {
      health.checks.asu_api = {
        name: 'ASU API',
        status: 'unhealthy',
        error: error instanceof Error ? error.message : 'Unknown error',
      };
      escalateStatus('degraded');
    }
  }

  // 2b. Check Cron Lock Status (Durable Object)
  try {
    const cfEnv = env as unknown as {
      PICKMYCLASS_CRON_LOCK_DO?: DurableObjectNamespace;
    };

    if (cfEnv?.PICKMYCLASS_CRON_LOCK_DO) {
      const lockId = cfEnv.PICKMYCLASS_CRON_LOCK_DO.idFromName('pickmyclass-cron-lock');
      const lockStub = cfEnv.PICKMYCLASS_CRON_LOCK_DO.get(lockId);

      const lockStatusResponse = await lockStub.fetch('http://do/status');
      const lockStatus = (await lockStatusResponse.json()) as {
        locked: boolean;
        lockHolder: string | null;
        lockAcquiredAt: number | null;
        timeHeldMs: number | null;
        expiresAt: number | null;
      };

      health.checks.cron_lock = {
        status: 'healthy',
        type: 'durable_object',
        locked: lockStatus.locked,
        lock_holder: lockStatus.lockHolder,
        time_held_ms: lockStatus.timeHeldMs,
        lock_acquired_at: lockStatus.lockAcquiredAt
          ? new Date(lockStatus.lockAcquiredAt).toISOString()
          : null,
        expires_at: lockStatus.expiresAt ? new Date(lockStatus.expiresAt).toISOString() : null,
      };
    } else {
      health.checks.cron_lock = {
        status: 'not_configured',
        type: 'durable_object',
        message: 'PICKMYCLASS_CRON_LOCK_DO binding not available',
      };
    }
  } catch (error) {
    health.checks.cron_lock = {
      status: 'unhealthy',
      type: 'durable_object',
      error: error instanceof Error ? error.message : 'Unknown error',
    };
    escalateStatus('degraded');
  }

  // 3. Check Environment Configuration
  const requiredEnvVars = [
    'NEXT_PUBLIC_SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
    'ASU_API_BASE_URL',
    'ASU_API_TOKEN',
    'CRON_SECRET',
  ];

  const missingEnvVars = requiredEnvVars.filter((key) => !process.env[key] && !cfRecord[key]);

  health.checks.configuration = {
    status: missingEnvVars.length === 0 ? 'healthy' : 'unhealthy',
    missing_vars: missingEnvVars.length > 0 ? missingEnvVars : undefined,
  };

  if (missingEnvVars.length > 0) {
    escalateStatus('unhealthy');
  }

  // 4. Check Optional Services
  health.checks.email = {
    status: process.env.RESEND_API_KEY ? 'healthy' : 'not_configured',
    configured: !!process.env.RESEND_API_KEY,
  };

  // 5. Overall Response Time
  health.response_time_ms = Date.now() - startTime;

  // Return appropriate status code
  const statusCode = health.status === 'healthy' ? 200 : health.status === 'degraded' ? 503 : 500;

  healthCache.set('health', { body: health, statusCode });

  return NextResponse.json(health, { status: statusCode });
}
