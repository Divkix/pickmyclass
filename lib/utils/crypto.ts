import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Compare two strings in constant time to prevent timing attacks.
 *
 * Both inputs are hashed to fixed-length SHA-256 digests before comparison,
 * which ensures:
 *  - Unequal-length inputs can never compare equal (e.g. "secret" ≠ "secret\0")
 *  - The comparison always takes constant time regardless of input length
 *  - Length information is not leaked through the comparison itself
 */
export function timingSafeCompare(a: string, b: string): boolean {
  const da = createHash('sha256').update(a, 'utf8').digest();
  const db = createHash('sha256').update(b, 'utf8').digest();
  return timingSafeEqual(da, db);
}
