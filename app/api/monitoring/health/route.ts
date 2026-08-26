/**
 * System Health and Monitoring Endpoint
 *
 * Provides real-time system status including ASU API, database, and cron lock.
 */

import { env } from 'cloudflare:workers';
import { NextResponse } from 'next/server';
import { fetchClassFromASU, NotFoundError } from '@/lib/asu/api';
import { TtlCache } from '@/lib/cache/ttl-cache';
import { getDbFromEnv } from '@/lib/db';
import { classWatches } from '@/lib/db/schema';
import { timingSafeCompare } from '@/lib/utils/crypto';
import { createCronLockClient } from '@/lib/worker/cron-lock';

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

type HealthCheckResult = {
  status: string;
  latency_ms?: number;
  error?: string;
  name?: string;
  type?: string;
  locked?: boolean;
  lock_holder?: string | null;
  time_held_ms?: number | null;
  lock_acquired_at?: string | null;
  expires_at?: string | null;
  message?: string;
  missing_vars?: string[];
  configured?: boolean;
  missing?: string[];
  [key: string]: JsonValue | undefined;
};

interface HealthStatus {
  timestamp: string;
  status: 'healthy' | 'degraded' | 'unhealthy';
  checks: Record<string, HealthCheckResult>;
  response_time_ms?: number;
}

const healthCache = new TtlCache<{ body: HealthStatus; statusCode: number }>(60_000, 50);

/**
 * GET /api/monitoring/health
 *
 * Returns system health status for monitoring and alerting
 * Public endpoint - no authentication required
 */
// Read-only TTL cache for health monitoring — not a mutation
// eslint-disable-next-line react-doctor/nextjs-no-side-effect-in-get-handler
export async function GET(request: Request) {
  // Auth check first - unauthenticated requests get a simple liveness probe
  // without running expensive DB/DO queries (prevents DoS via health endpoint)
  const authHeader = request.headers.get('authorization');
  // SAFETY: Cloudflare Workers env is opaque runtime value; widen to unknown before narrowing to string record for health checks.
  const rawEnv: unknown = env;
  // SAFETY: Record<string, string | undefined> reflects the dynamic env contract for health checks; narrowed from unknown after runtime widening.
  const cfRecord = rawEnv as Record<string, string | undefined>;
  const cronSecret = process.env.CRON_SECRET || cfRecord.CRON_SECRET;
  const isAuthenticated =
    !!cronSecret && !!authHeader && timingSafeCompare(authHeader, `Bearer ${cronSecret}`);

  if (!isAuthenticated) {
    // Intentional exception: unauthenticated liveness probe uses { status: 'ok' }
    // (external monitoring contract — not the ok()/fail() envelope).
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

  // Parallelize independent probes via Promise.allSettled (health stays tolerant: one failure doesn't mask others)
  const [dbResult, asuResult, cronResult] = await Promise.allSettled([
    (async () => {
      try {
        // One request-scoped Drizzle handle for this invocation.
        const db = getDbFromEnv();
        await db.select({ id: classWatches.id }).from(classWatches).limit(1);
        return { kind: 'db_ok' as const, latency_ms: Date.now() - startTime };
      } catch (error) {
        return {
          kind: 'db_error' as const,
          message: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    })(),
    (async () => {
      try {
        // SAFETY: ASU API credentials are required Cloudflare secrets validated by deployment; shape matches wrangler.jsonc env contract.
        const asuEnv = env as { ASU_API_BASE_URL: string; ASU_API_TOKEN: string };
        await fetchClassFromASU({ class_nbr: '10001', term: '2251' }, asuEnv);
        return { kind: 'asu_ok' as const };
      } catch (error) {
        if (error instanceof NotFoundError) return { kind: 'asu_ok' as const };
        return {
          kind: 'asu_error' as const,
          message: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    })(),
    (async () => {
      try {
        // SAFETY: Durable Object namespace binding is an optional Cloudflare binding; shape matches wrangler.jsonc env contract.
        const cfEnv = env as {
          PICKMYCLASS_CRON_LOCK_DO?: DurableObjectNamespace;
        };
        const lockStatus = await createCronLockClient(cfEnv?.PICKMYCLASS_CRON_LOCK_DO).status();
        return { kind: 'cron_ok' as const, lockStatus };
      } catch (error) {
        return {
          kind: 'cron_error' as const,
          message: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    })(),
  ]);

  // Database check
  if (dbResult.status === 'fulfilled') {
    const v = dbResult.value;
    if (v.kind === 'db_ok') {
      health.checks.database = { status: 'healthy', latency_ms: v.latency_ms };
    } else {
      health.checks.database = { status: 'unhealthy', error: v.message };
      escalateStatus('degraded');
    }
  } else {
    health.checks.database = {
      status: 'unhealthy',
      error: dbResult.reason instanceof Error ? dbResult.reason.message : 'Unknown error',
    };
    escalateStatus('unhealthy');
  }

  // ASU API check
  if (asuResult.status === 'fulfilled') {
    const v = asuResult.value;
    if (v.kind === 'asu_ok') {
      health.checks.asu_api = { name: 'ASU API', status: 'healthy' };
    } else {
      health.checks.asu_api = { name: 'ASU API', status: 'unhealthy', error: v.message };
      escalateStatus('degraded');
    }
  } else {
    const msg = asuResult.reason instanceof Error ? asuResult.reason.message : 'Unknown error';
    if (asuResult.reason instanceof NotFoundError) {
      health.checks.asu_api = { name: 'ASU API', status: 'healthy' };
    } else {
      health.checks.asu_api = { name: 'ASU API', status: 'unhealthy', error: msg };
      escalateStatus('degraded');
    }
  }

  // Cron lock check
  if (cronResult.status === 'fulfilled') {
    const v = cronResult.value;
    if (v.kind === 'cron_ok') {
      const lockStatus = v.lockStatus;
      if (lockStatus) {
        health.checks.cron_lock = {
          status: 'healthy',
          type: 'durable_object',
          locked: lockStatus.locked,
          lock_holder: lockStatus.lockHolder,
          time_held_ms: lockStatus.timeHeldMs,
          lock_acquired_at:
            lockStatus.lockAcquiredAt !== null
              ? new Date(lockStatus.lockAcquiredAt).toISOString()
              : null,
          expires_at:
            lockStatus.expiresAt !== null ? new Date(lockStatus.expiresAt).toISOString() : null,
        };
      } else {
        health.checks.cron_lock = {
          status: 'not_configured',
          type: 'durable_object',
          message: 'PICKMYCLASS_CRON_LOCK_DO binding not available',
        };
      }
    } else {
      health.checks.cron_lock = {
        status: 'unhealthy',
        type: 'durable_object',
        error: v.message,
      };
      escalateStatus('degraded');
    }
  } else {
    health.checks.cron_lock = {
      status: 'unhealthy',
      type: 'durable_object',
      error: cronResult.reason instanceof Error ? cronResult.reason.message : 'Unknown error',
    };
    escalateStatus('degraded');
  }

  // 3. Check Environment Configuration
  const requiredEnvVars = ['ASU_API_BASE_URL', 'ASU_API_TOKEN', 'CRON_SECRET'];

  const missingEnvVars = requiredEnvVars.filter((key) => !process.env[key] && !cfRecord[key]);

  health.checks.configuration = {
    status: missingEnvVars.length === 0 ? 'healthy' : 'unhealthy',
    missing_vars: missingEnvVars.length > 0 ? missingEnvVars : undefined,
  };

  if (missingEnvVars.length > 0) {
    escalateStatus('unhealthy');
  }

  // SAFETY: Cloudflare Email binding is an optional service binding; shape matches wrangler.jsonc env contract.
  const emailEnv = env as { EMAIL?: SendEmail };
  const emailConfigured = !!emailEnv.EMAIL;
  const fromEmail = process.env.NOTIFICATION_FROM_EMAIL || cfRecord.NOTIFICATION_FROM_EMAIL;
  const missingEmailConfig = [
    ...(!emailConfigured ? ['EMAIL binding'] : []),
    ...(!fromEmail ? ['NOTIFICATION_FROM_EMAIL'] : []),
  ];
  health.checks.email = {
    status: emailConfigured && fromEmail ? 'healthy' : 'unhealthy',
    configured: emailConfigured && !!fromEmail,
    missing: missingEmailConfig.length > 0 ? missingEmailConfig : undefined,
  };

  if (!emailConfigured || !fromEmail) {
    escalateStatus('unhealthy');
  }

  // 5. Overall Response Time
  health.response_time_ms = Date.now() - startTime;

  // Return appropriate status code
  const statusCode = health.status === 'healthy' ? 200 : health.status === 'degraded' ? 503 : 500;

  healthCache.set('health', { body: health, statusCode });

  return NextResponse.json(health, { status: statusCode });
}
