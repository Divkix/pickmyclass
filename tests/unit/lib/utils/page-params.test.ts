import { describe, expect, it } from 'vite-plus/test';
import { parsePageParam } from '@/lib/utils/page-params';

describe('parsePageParam', () => {
  it('parses a valid positive integer', () => {
    expect(parsePageParam('100')).toBe(100);
    expect(parsePageParam('5')).toBe(5);
  });

  it('floors decimal values to the nearest integer', () => {
    expect(parsePageParam('2.7')).toBe(2);
    expect(parsePageParam('1.9')).toBe(1);
  });

  it('clamps values below 1 to 1', () => {
    expect(parsePageParam('0')).toBe(1);
    expect(parsePageParam('-5')).toBe(1);
  });

  it('falls back for non-numeric input', () => {
    expect(parsePageParam('abc')).toBe(1);
    expect(parsePageParam('Infinity')).toBe(1);
  });

  it('falls back when the param is empty or absent', () => {
    expect(parsePageParam('')).toBe(1);
    expect(parsePageParam(undefined)).toBe(1);
  });

  it('uses the provided fallback for missing or invalid input', () => {
    expect(parsePageParam(undefined, 3)).toBe(3);
    expect(parsePageParam('abc', 7)).toBe(7);
  });
});
