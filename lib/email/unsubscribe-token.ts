/**
 * Unsubscribe Token Generation and Verification
 *
 * Creates and validates signed tokens for one-click unsubscribe links.
 * Tokens are HMAC-signed to prevent tampering.
 */

import { createHmac } from 'node:crypto';
import { DEFAULT_SITE_URL, UNSUBSCRIBE_TOKEN_EXPIRY_DAYS } from '@/lib/config';
import { timingSafeCompare } from '@/lib/utils/crypto';

/**
 * Generate a secret key for HMAC signing
 */
function getSigningSecret(): string {
  const secret = process.env.UNSUBSCRIBE_SIGNING_SECRET;
  if (!secret) {
    throw new Error(
      'UNSUBSCRIBE_SIGNING_SECRET is not set. ' +
        'Required for HMAC token signing. Set this via wrangler secret put UNSUBSCRIBE_SIGNING_SECRET.'
    );
  }
  return secret;
}

/**
 * Generate a signed unsubscribe token
 *
 * Token format: base64(userId:expiresAt:signature)
 * Expires in 90 days by default
 */
export function generateUnsubscribeToken(
  userId: string,
  // Default to UNSUBSCRIBE_TOKEN_EXPIRY_DAYS (90 days) to preserve backward compatibility
  expiresInDays = UNSUBSCRIBE_TOKEN_EXPIRY_DAYS
): string {
  const expiresAt = Date.now() + expiresInDays * 24 * 60 * 60 * 1000;
  const payload = `${userId}:${expiresAt}`;

  // Sign the payload with HMAC-SHA256
  const secret = getSigningSecret();
  const signature = createHmac('sha256', secret).update(payload).digest('hex');

  // Combine payload and signature
  const token = `${payload}:${signature}`;

  // Base64 encode for URL safety
  return Buffer.from(token).toString('base64url');
}

/**
 * Verify and decode an unsubscribe token
 *
 * @returns userId if valid, null if invalid/expired
 */
export function verifyUnsubscribeToken(token: string): string | null {
  try {
    // Decode base64
    const decoded = Buffer.from(token, 'base64url').toString('utf-8');
    const parts = decoded.split(':');

    if (parts.length !== 3) {
      console.warn('[UnsubscribeToken] Invalid token format');
      return null;
    }

    const [userId, expiresAtStr, providedSignature] = parts;
    const expiresAt = parseInt(expiresAtStr, 10);

    // Check expiration
    if (Date.now() > expiresAt) {
      console.warn('[UnsubscribeToken] Token expired');
      return null;
    }

    // Verify signature
    const payload = `${userId}:${expiresAt}`;
    const secret = getSigningSecret();
    const expectedSignature = createHmac('sha256', secret).update(payload).digest('hex');

    if (!timingSafeCompare(providedSignature, expectedSignature)) {
      console.warn('[UnsubscribeToken] Invalid signature');
      return null;
    }

    return userId;
  } catch (error) {
    console.error('[UnsubscribeToken] Error verifying token:', error);
    return null;
  }
}

/**
 * Generate unsubscribe URL for email footer
 */
export function generateUnsubscribeUrl(userId: string, baseUrl?: string): string {
  const token = generateUnsubscribeToken(userId);
  const url = baseUrl || process.env.NEXT_PUBLIC_SITE_URL || DEFAULT_SITE_URL;
  return `${url}/api/unsubscribe?token=${token}`;
}
