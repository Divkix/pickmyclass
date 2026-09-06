import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
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

  it('deletes specific key and returns true when key existed', () => {
    const cache = new TtlCache<string>(1000);
    cache.set('key', 'value');

    const result = cache.delete('key');

    expect(result).toBe(true);
    expect(cache.get('key')).toBeUndefined();
  });

  it('returns false when deleting non-existent key', () => {
    const cache = new TtlCache<string>(1000);

    const result = cache.delete('non-existent');

    expect(result).toBe(false);
  });
});
