import { createHmac } from 'node:crypto';
import { DEFAULT_SITE_URL, UNSUBSCRIBE_TOKEN_EXPIRY_DAYS } from '@/lib/config';
import { log } from '@/lib/log';
import { timingSafeCompare } from '@/lib/utils/crypto';

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

export function generateUnsubscribeToken(
  userId: string,
  expiresInDays = UNSUBSCRIBE_TOKEN_EXPIRY_DAYS
): string {
  const expiresAt = Date.now() + expiresInDays * 24 * 60 * 60 * 1000;
  const payload = `${userId}:${expiresAt}`;

  const secret = getSigningSecret();
  const signature = createHmac('sha256', secret).update(payload).digest('hex');

  const token = `${payload}:${signature}`;

  return Buffer.from(token).toString('base64url');
}

export function verifyUnsubscribeToken(token: string): string | null {
  try {
    const decoded = Buffer.from(token, 'base64url').toString('utf-8');
    const parts = decoded.split(':');

    if (parts.length !== 3) {
      log('UnsubscribeToken').warn('Invalid token format');
      return null;
    }

    const [userId, expiresAtStr, providedSignature] = parts;
    const expiresAt = parseInt(expiresAtStr, 10);

    if (Date.now() > expiresAt) {
      log('UnsubscribeToken').warn('Token expired');
      return null;
    }

    const payload = `${userId}:${expiresAt}`;
    const secret = getSigningSecret();
    const expectedSignature = createHmac('sha256', secret).update(payload).digest('hex');

    if (!timingSafeCompare(providedSignature, expectedSignature)) {
      log('UnsubscribeToken').warn('Invalid signature');
      return null;
    }

    return userId;
  } catch (error) {
    log('UnsubscribeToken').error('Error verifying token:', error);
    return null;
  }
}

export function generateUnsubscribeUrl(userId: string, baseUrl?: string): string {
  const token = generateUnsubscribeToken(userId);
  const url = baseUrl || process.env.NEXT_PUBLIC_SITE_URL || DEFAULT_SITE_URL;
  return `${url}/api/unsubscribe?token=${token}`;
}
