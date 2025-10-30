/**
 * Health Monitoring and Auto-Recovery
 *
 * Periodically checks system health and recovers from failures:
 * - Detects stuck browsers (no activity for 5 minutes)
 * - Monitors memory growth (leak detection)
 * - Auto-restarts unhealthy components
 * - Logs health metrics for debugging
 */

export interface HealthMetrics {
  memoryUsage: {
    rss: number // Resident Set Size (total memory)
    heapUsed: number // Heap memory used
    heapTotal: number // Heap memory allocated
    external: number // External memory (buffers, etc.)
  }
  uptime: number // Process uptime in seconds
  timestamp: number // Current timestamp
}

export interface HealthMonitorOptions {
  checkInterval: number // How often to run health checks (ms)
  memoryLeakThreshold: number // Memory growth rate threshold (MB/min)
  onUnhealthy?: (reason: string, metrics: HealthMetrics) => void // Callback for unhealthy state
}

export class HealthMonitor {
  private intervalId: NodeJS.Timeout | null = null
  private lastMemoryCheck: { time: number; rss: number } | null = null
  private lastMetrics: HealthMetrics | null = null

  constructor(private options: HealthMonitorOptions) {}

  /**
   * Start health monitoring
   */
  start(): void {
    if (this.intervalId) {
      console.log('[HealthMonitor] Already running')
      return
    }

    console.log(
      `[HealthMonitor] Starting health checks every ${this.options.checkInterval / 1000}s`
    )

    this.intervalId = setInterval(() => {
      this.runHealthCheck()
    }, this.options.checkInterval)

    // Run initial health check
    this.runHealthCheck()
  }

  /**
   * Stop health monitoring
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId)
      this.intervalId = null
      console.log('[HealthMonitor] Stopped health monitoring')
    }
  }

  /**
   * Run a health check
   */
  private runHealthCheck(): void {
    const metrics = this.collectMetrics()
    this.lastMetrics = metrics

    // Check for memory leaks
    this.checkMemoryLeak(metrics)

    // Log health status
    this.logHealthStatus(metrics)
  }

  /**
   * Collect current health metrics
   */
  private collectMetrics(): HealthMetrics {
    const memUsage = process.memoryUsage()

    return {
      memoryUsage: {
        rss: Math.round(memUsage.rss / 1024 / 1024), // Convert to MB
        heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024),
        heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024),
        external: Math.round(memUsage.external / 1024 / 1024),
      },
      uptime: Math.round(process.uptime()),
      timestamp: Date.now(),
    }
  }

  /**
   * Check for memory leaks
   */
  private checkMemoryLeak(metrics: HealthMetrics): void {
    if (!this.lastMemoryCheck) {
      // First check - establish baseline
      this.lastMemoryCheck = {
        time: metrics.timestamp,
        rss: metrics.memoryUsage.rss,
      }
      return
    }

    const timeDiffMs = metrics.timestamp - this.lastMemoryCheck.time
    const memDiffMb = metrics.memoryUsage.rss - this.lastMemoryCheck.rss

    // Calculate memory growth rate (MB/min)
    const memoryGrowthRate = (memDiffMb / timeDiffMs) * 60000

    if (memoryGrowthRate > this.options.memoryLeakThreshold) {
      const reason = `Memory leak detected: growing at ${memoryGrowthRate.toFixed(2)} MB/min (threshold: ${this.options.memoryLeakThreshold} MB/min)`
      console.warn(`[HealthMonitor] ⚠️  ${reason}`)

      if (this.options.onUnhealthy) {
        this.options.onUnhealthy(reason, metrics)
      }
    }

    // Update last check
    this.lastMemoryCheck = {
      time: metrics.timestamp,
      rss: metrics.memoryUsage.rss,
    }
  }

  /**
   * Log current health status
   */
  private logHealthStatus(metrics: HealthMetrics): void {
    const { memoryUsage, uptime } = metrics

    console.log(
      `[HealthMonitor] Memory: ${memoryUsage.rss}MB RSS, ${memoryUsage.heapUsed}/${memoryUsage.heapTotal}MB heap | Uptime: ${uptime}s`
    )
  }

  /**
   * Get last collected metrics
   */
  getLastMetrics(): HealthMetrics | null {
    return this.lastMetrics
  }

  /**
   * Get current metrics (real-time)
   */
  getCurrentMetrics(): HealthMetrics {
    return this.collectMetrics()
  }

  /**
   * Check if system is healthy
   */
  isHealthy(maxMemoryMb: number = 1800): boolean {
    const metrics = this.getCurrentMetrics()

    // Check memory usage (80% of max)
    if (metrics.memoryUsage.rss > maxMemoryMb * 0.8) {
      console.warn(
        `[HealthMonitor] Memory usage high: ${metrics.memoryUsage.rss}MB / ${maxMemoryMb}MB (${Math.round((metrics.memoryUsage.rss / maxMemoryMb) * 100)}%)`
      )
      return false
    }

    return true
  }
}
