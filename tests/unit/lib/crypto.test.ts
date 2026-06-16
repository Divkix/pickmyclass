import { describe, expect, it } from 'vite-plus/test';
import { timingSafeCompare } from '@/lib/utils/crypto';

describe('timingSafeCompare', () => {
  it('should return true for two identical strings', () => {
    expect(timingSafeCompare('secret', 'secret')).toBe(true);
  });

  it('should return false for two different strings', () => {
    expect(timingSafeCompare('secret', 'other')).toBe(false);
  });

  it('should return false for a string vs the same string with a NUL byte appended (regression: zero-pad bug)', () => {
    // The old implementation zero-padded both buffers to the same length, so
    // "secret" (padded with \0) compared equal to "secret\0". This must be false.
    expect(timingSafeCompare('secret', 'secret\0')).toBe(false);
  });

  it('should return true for two empty strings', () => {
    expect(timingSafeCompare('', '')).toBe(true);
  });

  it('should return false for two strings of different lengths', () => {
    expect(timingSafeCompare('short', 'longer-string')).toBe(false);
  });

  it('should return false when one string is empty and the other is not', () => {
    expect(timingSafeCompare('', 'nonempty')).toBe(false);
    expect(timingSafeCompare('nonempty', '')).toBe(false);
  });

  it('should return false for strings that differ only by a trailing NUL byte in either position', () => {
    expect(timingSafeCompare('\0secret', 'secret')).toBe(false);
    expect(timingSafeCompare('secret', '\0secret')).toBe(false);
  });

  it('should return true for long equal strings', () => {
    const long = 'a'.repeat(1000);
    expect(timingSafeCompare(long, long)).toBe(true);
  });

  it('should handle Bearer-prefixed secrets as used by verifyCronSecret', () => {
    const secret = 'my-cron-secret-value';
    expect(timingSafeCompare(`Bearer ${secret}`, `Bearer ${secret}`)).toBe(true);
    expect(timingSafeCompare(`Bearer ${secret}`, `Bearer wrong-secret`)).toBe(false);
  });
});
