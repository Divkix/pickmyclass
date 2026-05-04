/**
 * Lightweight in-memory TTL cache for Cloudflare Workers.
 *
 * Per-isolate, auto-evicts expired entries on read.
 * Not shared across Workers instances — use for reducing
 * redundant calls within a single isolate's lifetime.
 */
export class TtlCache<T> {
  private cache = new Map<string, { data: T; expiry: number }>();

  constructor(private ttlMs: number) {}

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
  }

  clear(): void {
    this.cache.clear();
  }

  delete(key: string): boolean {
    return this.cache.delete(key);
  }
}
