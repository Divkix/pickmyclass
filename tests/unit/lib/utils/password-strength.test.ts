import { describe, expect, it } from 'vite-plus/test';
import { calculatePasswordStrength } from '@/lib/utils/password-strength';

describe('calculatePasswordStrength', () => {
  it('scores 0 for an empty password', () => {
    expect(calculatePasswordStrength('')).toEqual({ score: 0, feedback: {} });
  });

  it('scores a long lowercase passphrase high enough to pass the register gate', () => {
    // 25 lowercase chars: three length points (>= 8, >= 12, >= 16) so a long
    // low-variety passphrase clears the score >= 3 gate (regression fix).
    const result = calculatePasswordStrength('a'.repeat(25));
    expect(result.score).toBeGreaterThanOrEqual(3);
  });

  it('keeps a short simple password below the gate', () => {
    // 8 lowercase chars: only the >= 8 length point.
    const result = calculatePasswordStrength('abcdefgh');
    expect(result.score).toBeLessThan(3);
  });

  it('never exceeds a score of 4', () => {
    // 16+ chars with upper/lower/digit/special would be 6 raw points.
    const result = calculatePasswordStrength('Abcdefghijkl1234!@');
    expect(result.score).toBe(4);
  });
});
