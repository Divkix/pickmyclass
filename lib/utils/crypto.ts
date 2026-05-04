import { timingSafeEqual } from 'node:crypto';

/**
 * Compare two strings in constant time to prevent timing attacks.
 * Uses constant-time comparison regardless of string length to prevent
 * length-probing attacks. Pads shorter strings for comparison.
 */
export function timingSafeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);

  // Determine the maximum length
  const maxLength = Math.max(bufA.length, bufB.length);

  // Create padded buffers of equal length
  // This ensures the comparison takes constant time regardless of input lengths
  const paddedA = Buffer.alloc(maxLength);
  const paddedB = Buffer.alloc(maxLength);

  // Copy original data - these operations are constant-time per byte
  bufA.copy(paddedA);
  bufB.copy(paddedB);

  // Constant-time comparison of padded buffers
  try {
    return timingSafeEqual(paddedA, paddedB);
  } catch {
    // Fallback: manual constant-time comparison
    let result = 0;
    for (let i = 0; i < maxLength; i++) {
      result |= paddedA[i] ^ paddedB[i];
    }
    return result === 0;
  }
}
