import cors from 'cors';
import dotenv from 'dotenv';
import express, { type NextFunction, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { CircuitBreaker } from './circuit-breaker.js';
import { HealthMonitor } from './health-monitor.js';
import { RequestQueue } from './queue.js';
import {
  getBrowserStatus,
  isValidSectionNumber,
  isValidTerm,
  scrapeClassSection,
} from './scraper.js';
import type { ScrapeRequest, ScrapeResponse } from './types.js';

// Load environment variables
dotenv.config();

// Initialize production-grade components
const circuitBreaker = new CircuitBreaker({
  failureThreshold: parseInt(process.env.CIRCUIT_BREAKER_THRESHOLD || '10', 10),
  successThreshold: 3,
  timeout: parseInt(process.env.CIRCUIT_BREAKER_TIMEOUT || '120000', 10), // 2 minutes
});

const requestQueue = new RequestQueue(
  parseInt(process.env.MAX_CONCURRENT_REQUESTS || '10', 10),
  500 // max queue size
);

const healthMonitor = new HealthMonitor({
  checkInterval: 60000, // Check every 60 seconds
  memoryLeakThreshold: 10, // Alert if growing > 10 MB/min
  onUnhealthy: (reason, metrics) => {
    console.error(`[HealthMonitor] ⚠️  UNHEALTHY: ${reason}`);
    console.error(`[HealthMonitor] Memory: ${metrics.memoryUsage.rss}MB RSS`);
  },
});

// Start health monitoring
healthMonitor.start();
console.log('[HealthMonitor] Started with 60s interval');

const app = express();
const PORT = process.env.PORT || 3000;
const SECRET_TOKEN = process.env.SECRET_TOKEN;

if (!SECRET_TOKEN) {
  console.warn('[Warning] SECRET_TOKEN not set in environment - authentication will fail');
}

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json());

/**
 * Rate limiting configuration for high concurrency workload
 *
 * PRODUCTION NOTES:
 * - This service is designed to handle high concurrent load from Cloudflare Workers
 * - Cron jobs will send 6,250 requests every 30 minutes (batch size 3, 2000+ sections)
 * - Peak load: ~350 req/min during cron execution windows
 * - Bearer token authentication provides security - rate limiting is for safety only
 *
 * Current settings: 1000 req/min per IP
 * - Allows ~16.6 req/sec sustained throughput
 * - Prevents accidental DDoS from misconfigurations
 * - Does NOT throttle legitimate Cloudflare Workers traffic
 *
 * If you need to REMOVE rate limiting entirely (not recommended):
 * Comment out lines 43-49 and line 51
 */
const limiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute window
  max: 1000, // 1000 requests per minute (16.6 req/sec)
  message: { error: 'Rate limit exceeded - contact admin if you need higher limits' },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use(limiter);

/**
 * Authentication middleware
 * Checks for Bearer token in Authorization header
 */
const authenticate = (req: Request, res: Response, next: NextFunction): void => {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    res.status(401).json({ error: 'Missing Authorization header' });
    return;
  }

  if (!authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Invalid Authorization format. Use: Bearer <token>' });
    return;
  }

  const token = authHeader.substring(7); // Remove 'Bearer ' prefix

  if (token !== SECRET_TOKEN) {
    console.warn('[Auth] Unauthorized access attempt with invalid token');
    res.status(401).json({ error: 'Invalid token' });
    return;
  }

  console.log('[Auth] Request authenticated successfully');
  next();
};

/**
 * Health check endpoint
 * Public - no authentication required
 *
 * Returns 200 if healthy, 503 if unhealthy
 * Used by Docker healthcheck and monitoring systems
 */
app.get('/health', (_req: Request, res: Response) => {
  const poolStatus = getBrowserStatus();
  const circuitStats = circuitBreaker.getStats();
  const queueStats = requestQueue.getStats();
  const currentMetrics = healthMonitor.getCurrentMetrics();

  // Check if system is healthy
  const isHealthy =
    poolStatus.total > 0 && // At least 1 browser initialized
    poolStatus.available > 0 && // At least 1 browser available
    circuitStats.state !== 'OPEN' && // Circuit not permanently open
    healthMonitor.isHealthy(1800) && // Memory under 80% of 2GB (1.8GB)
    queueStats.pending < 400; // Queue not nearly full

  const status = isHealthy ? 'healthy' : 'unhealthy';
  const statusCode = isHealthy ? 200 : 503;

  res.status(statusCode).json({
    status,
    service: 'pickmyclass-scraper',
    version: '2.0.0',
    timestamp: new Date().toISOString(),
    uptime: Math.round(process.uptime()),
    checks: {
      browserPool: poolStatus.total > 0 && poolStatus.available > 0,
      circuitBreaker: circuitStats.state !== 'OPEN',
      memory: healthMonitor.isHealthy(1800),
      queue: queueStats.pending < 400,
    },
    details: {
      browserPool: `${poolStatus.available}/${poolStatus.total} available`,
      circuitBreaker: circuitStats.state,
      memory: `${currentMetrics.memoryUsage.rss}MB / 2048MB`,
      queue: `${queueStats.pending} pending / 500 max`,
    },
  });
});

/**
 * Browser pool status endpoint
 * Public - for monitoring and debugging
 *
 * Returns:
 * - total: Total browser instances in pool
 * - available: Browsers ready to accept jobs
 * - busy: Browsers currently processing jobs
 * - queued: Scrape jobs waiting for a browser
 */
app.get('/status', (_req: Request, res: Response) => {
  const poolStatus = getBrowserStatus();
  res.json({
    status: 'ok',
    service: 'pickmyclass-scraper',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    browserPool: poolStatus,
    health: {
      overloaded: poolStatus.queued > 50, // Warning if queue is large
      ready: poolStatus.total > 0 && poolStatus.available > 0,
    },
  });
});

/**
 * Metrics endpoint
 * Public - comprehensive monitoring data
 *
 * Returns detailed metrics for all system components:
 * - Browser pool (total, available, busy, queued)
 * - Circuit breaker (state, failures, next attempt time)
 * - Request queue (pending, active, completed, failed, rejected)
 * - Memory usage (RSS, heap used/total, external)
 * - Uptime and error rates
 */
app.get('/metrics', (_req: Request, res: Response) => {
  const poolStatus = getBrowserStatus();
  const circuitStats = circuitBreaker.getStats();
  const queueStats = requestQueue.getStats();
  const healthMetrics = healthMonitor.getCurrentMetrics();

  // Calculate error rate
  const totalRequests = queueStats.completed + queueStats.failed;
  const errorRate = totalRequests > 0 ? (queueStats.failed / totalRequests) * 100 : 0;

  res.json({
    service: 'pickmyclass-scraper',
    version: '2.0.0',
    timestamp: new Date().toISOString(),
    uptime: Math.round(process.uptime()),

    browserPool: {
      total: poolStatus.total,
      available: poolStatus.available,
      busy: poolStatus.busy,
      queued: poolStatus.queued,
    },

    circuitBreaker: {
      state: circuitStats.state,
      failures: circuitStats.failures,
      successes: circuitStats.successes,
      lastFailureTime: circuitStats.lastFailureTime
        ? new Date(circuitStats.lastFailureTime).toISOString()
        : null,
      nextAttemptTime: circuitStats.nextAttemptTime
        ? new Date(circuitStats.nextAttemptTime).toISOString()
        : null,
    },

    requestQueue: {
      pending: queueStats.pending,
      active: queueStats.active,
      completed: queueStats.completed,
      failed: queueStats.failed,
      rejected: queueStats.rejected,
      errorRate: `${errorRate.toFixed(2)}%`,
    },

    memory: {
      rss: `${healthMetrics.memoryUsage.rss}MB`,
      heapUsed: `${healthMetrics.memoryUsage.heapUsed}MB`,
      heapTotal: `${healthMetrics.memoryUsage.heapTotal}MB`,
      external: `${healthMetrics.memoryUsage.external}MB`,
    },

    health: {
      isHealthy: healthMonitor.isHealthy(1800),
      memoryUsagePercent: `${((healthMetrics.memoryUsage.rss / 2048) * 100).toFixed(1)}%`,
    },
  });
});

/**
 * Scrape endpoint
 * Protected - requires Bearer token authentication
 *
 * Request body:
 * {
 *   "sectionNumber": "12431",
 *   "term": "2261"
 * }
 */
app.post('/scrape', authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    const { sectionNumber, term } = req.body as ScrapeRequest;

    // Validate required fields
    if (!sectionNumber || !term) {
      res.status(400).json({
        success: false,
        error: 'Missing required fields: sectionNumber and term',
      } as ScrapeResponse);
      return;
    }

    // Validate formats
    if (!isValidSectionNumber(sectionNumber)) {
      res.status(400).json({
        success: false,
        error: 'Invalid sectionNumber format. Expected 5 digits (e.g., "12431")',
      } as ScrapeResponse);
      return;
    }

    if (!isValidTerm(term)) {
      res.status(400).json({
        success: false,
        error: 'Invalid term format. Expected 4 digits (e.g., "2261")',
      } as ScrapeResponse);
      return;
    }

    console.log(`[API] Received scrape request: section=${sectionNumber}, term=${term}`);

    // Perform scraping with circuit breaker and request queue protection
    const classDetails = await requestQueue.add(async () => {
      return await circuitBreaker.execute(async () => {
        return await scrapeClassSection(sectionNumber, term);
      });
    });

    res.json({
      success: true,
      data: classDetails,
    } as ScrapeResponse);
  } catch (error) {
    console.error('[API] Scraping error:', error);

    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';

    res.status(500).json({
      success: false,
      error: errorMessage,
    } as ScrapeResponse);
  }
});

/**
 * 404 handler for unknown routes
 */
app.use((_req: Request, res: Response) => {
  res.status(404).json({
    error: 'Route not found',
    availableEndpoints: {
      health: 'GET /health (healthcheck)',
      metrics: 'GET /metrics (detailed metrics)',
      status: 'GET /status (browser pool status)',
      scrape: 'POST /scrape (requires auth)',
    },
  });
});

/**
 * Global error handler
 */
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[Error] Unhandled error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined,
  });
});

/**
 * Start server with timeout configuration
 */
const server = app.listen(PORT, () => {
  console.log('='.repeat(50));
  console.log(`[Server] PickMyClass Scraper Service v2.0.0`);
  console.log(`[Server] Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`[Server] Listening on port ${PORT}`);
  console.log(`[Server] Health check: http://localhost:${PORT}/health`);
  console.log(`[Server] Metrics: http://localhost:${PORT}/metrics`);
  console.log(`[Server] Pool status: http://localhost:${PORT}/status`);
  console.log(`[Server] Auth enabled: ${!!SECRET_TOKEN}`);
  console.log(`[Server] Rate limit: 1000 req/min (16.6 req/sec)`);
  console.log(`[Server] Max concurrent: ${process.env.MAX_CONCURRENT_REQUESTS || 10} scrapes`);
  console.log(`[Server] Circuit breaker: ${process.env.CIRCUIT_BREAKER_THRESHOLD || 10} failures`);
  console.log(`[Server] Server timeout: 60s`);
  console.log('='.repeat(50));
});

// Set server timeout (60 seconds for scrape operations)
server.timeout = 60000; // 60 seconds

// Graceful shutdown on SIGTERM/SIGINT
process.on('SIGTERM', () => {
  console.log('[Server] SIGTERM received, shutting down gracefully...');
  healthMonitor.stop();
  server.close(() => {
    console.log('[Server] Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('[Server] SIGINT received, shutting down gracefully...');
  healthMonitor.stop();
  server.close(() => {
    console.log('[Server] Server closed');
    process.exit(0);
  });
});
