import { timingSafeEqual } from 'node:crypto';

/**
 * Compare two strings in constant time to prevent timing attacks.
 * Returns false for different lengths (length info is not sensitive for HMAC/token comparisons).
 */
export function timingSafeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
