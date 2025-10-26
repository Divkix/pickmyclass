/**
 * System Health and Monitoring Endpoint
 *
 * Provides real-time system status including circuit breakers, database, and scraper.
 */

import { NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase/service'
import { getScraperCircuitBreaker } from '@/lib/utils/circuit-breaker'

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

  // 2. Check Scraper Circuit Breaker
  const scraperCircuitBreaker = getScraperCircuitBreaker()
  const cbStatus = scraperCircuitBreaker.getStatus()

  health.checks.scraper = {
    status:
      cbStatus.state === 'CLOSED'
        ? 'healthy'
        : cbStatus.state === 'HALF_OPEN'
          ? 'degraded'
          : 'unhealthy',
    circuit_breaker: {
      state: cbStatus.state,
      failure_count: cbStatus.failureCount,
      success_count: cbStatus.successCount,
      last_failure: cbStatus.lastFailureTime
        ? new Date(cbStatus.lastFailureTime).toISOString()
        : null,
    },
  }

  if (cbStatus.state === 'OPEN') {
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
