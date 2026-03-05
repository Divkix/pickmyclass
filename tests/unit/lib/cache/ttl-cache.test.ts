import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TtlCache } from '@/lib/cache/ttl-cache';

describe('TtlCache', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns undefined for missing key', () => {
    const cache = new TtlCache<string>(1000);
    expect(cache.get('missing')).toBeUndefined();
  });

  it('returns cached value within TTL', () => {
    const cache = new TtlCache<string>(1000);
    cache.set('key', 'value');
    expect(cache.get('key')).toBe('value');
  });

  it('returns undefined after TTL expires', () => {
    const cache = new TtlCache<string>(1000);
    cache.set('key', 'value');

    vi.advanceTimersByTime(1001);
    expect(cache.get('key')).toBeUndefined();
  });

  it('returns value at exact TTL boundary', () => {
    const cache = new TtlCache<string>(1000);
    cache.set('key', 'value');

    vi.advanceTimersByTime(1000);
    expect(cache.get('key')).toBe('value');
  });

  it('overwrites existing entries', () => {
    const cache = new TtlCache<string>(1000);
    cache.set('key', 'first');
    cache.set('key', 'second');
    expect(cache.get('key')).toBe('second');
  });

  it('overwrite resets TTL', () => {
    const cache = new TtlCache<string>(1000);
    cache.set('key', 'first');

    vi.advanceTimersByTime(800);
    cache.set('key', 'second');

    vi.advanceTimersByTime(800);
    expect(cache.get('key')).toBe('second');
  });

  it('clears all entries', () => {
    const cache = new TtlCache<string>(1000);
    cache.set('a', '1');
    cache.set('b', '2');
    cache.clear();

    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')).toBeUndefined();
  });

  it('handles multiple keys independently', () => {
    const cache = new TtlCache<string>(1000);
    cache.set('a', '1');

    vi.advanceTimersByTime(500);
    cache.set('b', '2');

    vi.advanceTimersByTime(501);
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')).toBe('2');
  });

  it('works with TTL of 0', () => {
    const cache = new TtlCache<string>(0);
    cache.set('key', 'value');
    expect(cache.get('key')).toBe('value');

    vi.advanceTimersByTime(1);
    expect(cache.get('key')).toBeUndefined();
  });

  it('caches complex objects', () => {
    const cache = new TtlCache<{ count: number; items: string[] }>(5000);
    const obj = { count: 3, items: ['a', 'b', 'c'] };
    cache.set('data', obj);

    const result = cache.get('data');
    expect(result).toEqual(obj);
    expect(result).toBe(obj); // same reference
  });

  it('auto-evicts expired entry on get', () => {
    const cache = new TtlCache<string>(1000);
    cache.set('key', 'value');

    vi.advanceTimersByTime(1001);

    // First get should evict
    expect(cache.get('key')).toBeUndefined();
    // Setting again should work cleanly
    cache.set('key', 'new');
    expect(cache.get('key')).toBe('new');
  });
});
