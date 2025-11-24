/**
 * Unsubscribe Token Generation and Verification
 *
 * Creates and validates signed tokens for one-click unsubscribe links.
 * Tokens are HMAC-signed to prevent tampering.
 */

import { createHmac } from 'crypto';

/**
 * Generate a secret key for HMAC signing
 * Uses SUPABASE_SERVICE_ROLE_KEY as the signing secret
 */
function getSigningSecret(): string {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY || 'dev-secret-key';
  return secret;
}

/**
 * Generate a signed unsubscribe token
 *
 * Token format: base64(userId:expiresAt:signature)
 * Expires in 90 days by default
 */
export function generateUnsubscribeToken(userId: string, expiresInDays = 90): string {
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

    if (providedSignature !== expectedSignature) {
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
  const url = baseUrl || process.env.NEXT_PUBLIC_SITE_URL || 'https://pickmyclass.app';
  return `${url}/api/unsubscribe?token=${token}`;
}
