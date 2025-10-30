/**
 * Request Queue with Concurrency Control
 *
 * Prevents server overload by limiting concurrent scrape operations.
 * Uses p-queue for intelligent scheduling and backpressure.
 *
 * Features:
 * - Limit concurrent scrapes (default: 10)
 * - Reject requests when queue is full (default: 500 pending)
 * - Track metrics (pending, active, completed, failed)
 * - Priority support for urgent requests
 */

import PQueue from 'p-queue'

export interface QueueStats {
  pending: number // Requests waiting in queue
  active: number // Requests currently processing
  completed: number // Total completed requests
  failed: number // Total failed requests
  rejected: number // Total rejected requests (queue full)
}

export class RequestQueue {
  private queue: PQueue
  private stats: QueueStats = {
    pending: 0,
    active: 0,
    completed: 0,
    failed: 0,
    rejected: 0,
  }

  constructor(
    maxConcurrent: number = 10,
    private maxQueueSize: number = 500
  ) {
    this.queue = new PQueue({
      concurrency: maxConcurrent,
    })

    // Update pending count when queue changes
    this.queue.on('active', () => {
      this.stats.active = this.queue.pending
      this.stats.pending = this.queue.size
    })

    this.queue.on('idle', () => {
      this.stats.active = 0
      this.stats.pending = 0
    })
  }

  /**
   * Add task to queue
   * @throws Error if queue is full
   */
  async add<T>(fn: () => Promise<T>, priority: number = 0): Promise<T> {
    // Check if queue is full
    if (this.queue.size >= this.maxQueueSize) {
      this.stats.rejected++
      throw new Error(
        `Queue is full (${this.maxQueueSize} requests pending) - server overloaded`
      )
    }

    try {
      const result = await this.queue.add(fn, { priority })
      this.stats.completed++
      return result as T
    } catch (error) {
      this.stats.failed++
      throw error
    }
  }

  /**
   * Get current queue statistics
   */
  getStats(): QueueStats {
    return {
      ...this.stats,
      pending: this.queue.size,
      active: this.queue.pending,
    }
  }

  /**
   * Clear all pending tasks
   */
  clear(): void {
    this.queue.clear()
    console.log('[RequestQueue] Queue cleared')
  }

  /**
   * Wait for all pending tasks to complete
   */
  async onIdle(): Promise<void> {
    await this.queue.onIdle()
  }

  /**
   * Pause queue (stop processing new tasks)
   */
  pause(): void {
    this.queue.pause()
    console.log('[RequestQueue] Queue paused')
  }

  /**
   * Resume queue (start processing tasks again)
   */
  start(): void {
    this.queue.start()
    console.log('[RequestQueue] Queue resumed')
  }
}
