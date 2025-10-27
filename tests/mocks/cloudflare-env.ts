import { vi } from 'vitest'
import type { ClassCheckMessage } from '@/lib/types/queue'

/**
 * Mock Hyperdrive for database connection pooling
 */
export class MockHyperdrive {
  private queryResults: Map<string, unknown> = new Map()

  constructor() {
    this.connectionString = 'postgresql://mock:mock@localhost:5432/mock'
  }

  connectionString: string

  /**
   * Mock query execution
   */
  async query(sql: string, params?: unknown[]): Promise<{ rows: unknown[] }> {
    const key = `${sql}:${JSON.stringify(params || [])}`
    const result = this.queryResults.get(key) || { rows: [] }
    return Promise.resolve(result as { rows: unknown[] })
  }

  /**
   * Set mock query result for specific SQL
   */
  mockQueryResult(sql: string, params: unknown[], result: { rows: unknown[] }) {
    const key = `${sql}:${JSON.stringify(params)}`
    this.queryResults.set(key, result)
  }

  /**
   * Clear all mock results
   */
  clearMockResults() {
    this.queryResults.clear()
  }
}

/**
 * Mock Cloudflare Queue
 */
export class MockQueue {
  private messages: ClassCheckMessage[] = []
  public sendFn = vi.fn()
  public sendBatchFn = vi.fn()

  /**
   * Send single message to queue
   */
  async send(message: ClassCheckMessage): Promise<void> {
    this.messages.push(message)
    this.sendFn(message)
    return Promise.resolve()
  }

  /**
   * Send batch of messages to queue
   */
  async sendBatch(messages: ClassCheckMessage[]): Promise<void> {
    this.messages.push(...messages)
    this.sendBatchFn(messages)
    return Promise.resolve()
  }

  /**
   * Get all messages sent to queue
   */
  getMessages(): ClassCheckMessage[] {
    return [...this.messages]
  }

  /**
   * Clear queue
   */
  clear() {
    this.messages = []
    this.sendFn.mockClear()
    this.sendBatchFn.mockClear()
  }
}

/**
 * Mock KV Namespace for rate limiting and caching
 */
export class MockKVNamespace {
  private store: Map<string, string> = new Map()
  private metadata: Map<string, unknown> = new Map()
  public getFn = vi.fn()
  public putFn = vi.fn()
  public deleteFn = vi.fn()

  /**
   * Get value from KV store
   */
  async get(key: string, options?: { type?: 'text' | 'json' }): Promise<string | null> {
    this.getFn(key, options)
    const value = this.store.get(key) || null

    if (!value) return null

    if (options?.type === 'json') {
      return JSON.parse(value) as string
    }

    return value
  }

  /**
   * Put value in KV store
   */
  async put(
    key: string,
    value: string,
    options?: { expirationTtl?: number; metadata?: unknown }
  ): Promise<void> {
    this.putFn(key, value, options)
    this.store.set(key, value)
    if (options?.metadata) {
      this.metadata.set(key, options.metadata)
    }
    return Promise.resolve()
  }

  /**
   * Delete key from KV store
   */
  async delete(key: string): Promise<void> {
    this.deleteFn(key)
    this.store.delete(key)
    this.metadata.delete(key)
    return Promise.resolve()
  }

  /**
   * List keys in KV store
   */
  async list(): Promise<{ keys: { name: string }[] }> {
    return Promise.resolve({
      keys: Array.from(this.store.keys()).map(name => ({ name })),
    })
  }

  /**
   * Get metadata for key
   */
  getMetadata(key: string): unknown {
    return this.metadata.get(key)
  }

  /**
   * Clear KV store
   */
  clear() {
    this.store.clear()
    this.metadata.clear()
    this.getFn.mockClear()
    this.putFn.mockClear()
    this.deleteFn.mockClear()
  }
}
