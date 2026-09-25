import { env } from 'cloudflare:workers';
import { NextResponse } from 'next/server';
import { fetchClassFromASU, NotFoundError } from '@/lib/asu/api';
import { getDbFromEnv } from '@/lib/db';
import { classWatches } from '@/lib/db/schema';
import { verifyCronSecret } from '@/lib/auth/require-user';
import type { JsonValue } from '@/lib/api/wire';

type HealthCheckResult = {
  status: string;
  latency_ms?: number;
  error?: string;
  name?: string;
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

export async function GET(request: Request) {
  const rawEnv: unknown = env;
  // SAFETY: Workers env is opaque; widened to unknown then narrowed to string record for health checks
  const cfRecord = rawEnv as Record<string, string | undefined>;
  const cronSecret = process.env.CRON_SECRET || cfRecord.CRON_SECRET;
  const isAuthenticated = verifyCronSecret(request, cronSecret);

  if (!isAuthenticated) {
    return NextResponse.json({ status: 'ok' }, { status: 200 });
  }

  const startTime = Date.now();

  const health: HealthStatus = {
    timestamp: new Date().toISOString(),
    status: 'healthy',
    checks: {},
  };

  const escalateStatus = (newStatus: 'degraded' | 'unhealthy') => {
    const precedence = { healthy: 0, degraded: 1, unhealthy: 2 } as const;

    if (precedence[newStatus] > precedence[health.status]) {
      health.status = newStatus;
    }
  };

  const [dbResult, asuResult] = await Promise.allSettled([
    (async () => {
      try {
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
        // SAFETY: ASU credentials are required secrets validated at deploy; shape matches wrangler.jsonc contract
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
  ]);

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

  const requiredEnvVars = ['ASU_API_BASE_URL', 'ASU_API_TOKEN', 'CRON_SECRET'];

  const missingEnvVars = requiredEnvVars.filter((key) => !process.env[key] && !cfRecord[key]);

  health.checks.configuration = {
    status: missingEnvVars.length === 0 ? 'healthy' : 'unhealthy',
    missing_vars: missingEnvVars.length > 0 ? missingEnvVars : undefined,
  };

  if (missingEnvVars.length > 0) {
    escalateStatus('unhealthy');
  }

  // SAFETY: Email binding is optional; shape matches wrangler.jsonc contract
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

  health.response_time_ms = Date.now() - startTime;

  const statusCode = health.status === 'healthy' ? 200 : health.status === 'degraded' ? 503 : 500;

  return NextResponse.json(health, { status: statusCode });
}
