/**
 * Lightweight in-memory TTL cache for Cloudflare Workers.
 *
 * Per-isolate, auto-evicts expired entries on read.
 * Not shared across Workers instances — use for reducing
 * redundant calls within a single isolate's lifetime.
 */
// ponytail: lazy sweep on read/write; add interval sweeper if isolate lives >10m with bursty keys
export class TtlCache<T> {
  private cache = new Map<string, { data: T; expiry: number }>();

  constructor(
    private ttlMs: number,
    private maxSize: number = 500
  ) {}

  private evictExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache) {
      if (now > entry.expiry) this.cache.delete(key);
    }
  }

  get(key: string): T | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;

    if (Date.now() > entry.expiry) {
      this.cache.delete(key);
      return undefined;
    }

    return entry.data;
  }

  set(key: string, data: T): void {
    this.cache.set(key, { data, expiry: Date.now() + this.ttlMs });
    if (this.cache.size > this.maxSize) {
      this.evictExpired();
      while (this.cache.size > this.maxSize) {
        const oldestKey = this.cache.keys().next().value;
        if (oldestKey === undefined) break;
        this.cache.delete(oldestKey);
      }
    }
  }

  clear(): void {
    this.cache.clear();
  }

  delete(key: string): boolean {
    return this.cache.delete(key);
  }
}
