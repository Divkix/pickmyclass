/**
 * System Health and Monitoring Endpoint
 *
 * Provides real-time system status including circuit breakers, database, and scraper.
 */

import { NextResponse } from 'next/server'
import { getCloudflareContext } from '@opennextjs/cloudflare'
import { getServiceClient } from '@/lib/supabase/service'

/**
 * Health status response
 */
interface HealthStatus {
  timestamp: string
  status: 'healthy' | 'degraded' | 'unhealthy'
  checks: Record<string, unknown>
  response_time_ms?: number
}

/**
 * GET /api/monitoring/health
 *
 * Returns system health status for monitoring and alerting
 * Public endpoint - no authentication required
 */
export async function GET() {
  const startTime = Date.now()
  const health: HealthStatus = {
    timestamp: new Date().toISOString(),
    status: 'healthy',
    checks: {},
  }

  // 1. Check Database Connection
  try {
    const supabase = getServiceClient()
    const { error } = await supabase.from('class_watches').select('id').limit(1)

    if (error) {
      health.checks.database = {
        status: 'unhealthy',
        error: error.message,
      }
      health.status = 'degraded'
    } else {
      health.checks.database = {
        status: 'healthy',
        latency_ms: Date.now() - startTime,
      }
    }
  } catch (error) {
    health.checks.database = {
      status: 'unhealthy',
      error: error instanceof Error ? error.message : 'Unknown error',
    }
    health.status = 'unhealthy'
  }

  // 2. Check Scraper Circuit Breaker (Durable Object)
  try {
    const context = await getCloudflareContext()
    const env = context.env as unknown as {
      CIRCUIT_BREAKER_DO?: DurableObjectNamespace
      CRON_LOCK_DO?: DurableObjectNamespace
    }

    if (env?.CIRCUIT_BREAKER_DO) {
      const doId = env.CIRCUIT_BREAKER_DO.idFromName('scraper-circuit-breaker')
      const circuitBreakerStub = env.CIRCUIT_BREAKER_DO.get(doId)

      const statusResponse = await circuitBreakerStub.fetch('http://do/status')
      const cbStatus = await statusResponse.json() as {
        state: string
        failureCount: number
        successCount: number
        lastFailureTime: number | null
        lastStateChange: number
      }

      health.checks.circuit_breaker = {
        status:
          cbStatus.state === 'CLOSED'
            ? 'healthy'
            : cbStatus.state === 'HALF_OPEN'
              ? 'degraded'
              : 'unhealthy',
        type: 'durable_object',
        state: cbStatus.state,
        failure_count: cbStatus.failureCount,
        success_count: cbStatus.successCount,
        last_failure: cbStatus.lastFailureTime
          ? new Date(cbStatus.lastFailureTime).toISOString()
          : null,
        last_state_change: new Date(cbStatus.lastStateChange).toISOString(),
      }

      if (cbStatus.state === 'OPEN') {
        health.status = 'degraded'
      }
    } else {
      health.checks.circuit_breaker = {
        status: 'not_configured',
        type: 'durable_object',
        message: 'CIRCUIT_BREAKER_DO binding not available',
      }
    }

    // 2b. Check Cron Lock Status
    if (env?.CRON_LOCK_DO) {
      const lockId = env.CRON_LOCK_DO.idFromName('class-check-cron-lock')
      const lockStub = env.CRON_LOCK_DO.get(lockId)

      const lockStatusResponse = await lockStub.fetch('http://do/status')
      const lockStatus = await lockStatusResponse.json() as {
        locked: boolean
        lockHolder: string | null
        lockAcquiredAt: number | null
        timeHeldMs: number | null
        expiresAt: number | null
      }

      health.checks.cron_lock = {
        status: 'healthy',
        type: 'durable_object',
        locked: lockStatus.locked,
        lock_holder: lockStatus.lockHolder,
        time_held_ms: lockStatus.timeHeldMs,
        lock_acquired_at: lockStatus.lockAcquiredAt
          ? new Date(lockStatus.lockAcquiredAt).toISOString()
          : null,
        expires_at: lockStatus.expiresAt
          ? new Date(lockStatus.expiresAt).toISOString()
          : null,
      }
    } else {
      health.checks.cron_lock = {
        status: 'not_configured',
        type: 'durable_object',
        message: 'CRON_LOCK_DO binding not available',
      }
    }
  } catch (error) {
    health.checks.circuit_breaker = {
      status: 'unhealthy',
      type: 'durable_object',
      error: error instanceof Error ? error.message : 'Unknown error',
    }
    health.status = 'degraded'
  }

  // 3. Check Environment Configuration
  const requiredEnvVars = [
    'NEXT_PUBLIC_SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
    'SCRAPER_URL',
    'SCRAPER_SECRET_TOKEN',
    'CRON_SECRET',
  ]

  const missingEnvVars = requiredEnvVars.filter((key) => !process.env[key])

  health.checks.configuration = {
    status: missingEnvVars.length === 0 ? 'healthy' : 'unhealthy',
    missing_vars: missingEnvVars.length > 0 ? missingEnvVars : undefined,
  }

  if (missingEnvVars.length > 0) {
    health.status = 'unhealthy'
  }

  // 4. Check Optional Services
  health.checks.email = {
    status: process.env.RESEND_API_KEY ? 'healthy' : 'not_configured',
    configured: !!process.env.RESEND_API_KEY,
  }

  // 5. Overall Response Time
  health.response_time_ms = Date.now() - startTime

  // Return appropriate status code
  const statusCode = health.status === 'healthy' ? 200 : health.status === 'degraded' ? 503 : 500

  return NextResponse.json(health, { status: statusCode })
}
