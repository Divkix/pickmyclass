/**
 * Unsubscribe Token Generation and Verification
 *
 * Creates and validates signed tokens for one-click unsubscribe links.
 * Tokens are HMAC-signed to prevent tampering.
 */

import { createHmac } from 'crypto'

/**
 * Generate a secret key for HMAC signing
 * Uses SUPABASE_SERVICE_ROLE_KEY as the signing secret
 */
function getSigningSecret(): string {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY || 'dev-secret-key'
  return secret
}

/**
 * Allowed hosts for unsubscribe URLs (prevents open redirect)
 */
const ALLOWED_HOSTS = [
  'pickmyclass.app',
  'www.pickmyclass.app',
  'localhost',
  '127.0.0.1',
]

/**
 * Validate that a URL is safe to use as base URL
 * Prevents open redirect vulnerabilities
 */
function isValidBaseUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    // Only allow https (or http for localhost)
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return false
    }
    // Only allow http for localhost
    if (parsed.protocol === 'http:' && !parsed.hostname.match(/^(localhost|127\.0\.0\.1)$/)) {
      return false
    }
    // Check against allowed hosts
    return ALLOWED_HOSTS.some(
      (host) => parsed.hostname === host || parsed.hostname.endsWith(`.${host}`)
    )
  } catch {
    return false
  }
}

/**
 * Generate a signed unsubscribe token
 *
 * Token format: base64(userId:expiresAt:signature)
 * Expires in 30 days by default (reduced from 90 for security)
 */
export function generateUnsubscribeToken(userId: string, expiresInDays = 30): string {
  const expiresAt = Date.now() + expiresInDays * 24 * 60 * 60 * 1000
  const payload = `${userId}:${expiresAt}`

  // Sign the payload with HMAC-SHA256
  const secret = getSigningSecret()
  const signature = createHmac('sha256', secret).update(payload).digest('hex')

  // Combine payload and signature
  const token = `${payload}:${signature}`

  // Base64 encode for URL safety
  return Buffer.from(token).toString('base64url')
}

/**
 * Verify and decode an unsubscribe token
 *
 * @returns userId if valid, null if invalid/expired
 */
export function verifyUnsubscribeToken(token: string): string | null {
  try {
    // Decode base64
    const decoded = Buffer.from(token, 'base64url').toString('utf-8')
    const parts = decoded.split(':')

    if (parts.length !== 3) {
      console.warn('[UnsubscribeToken] Invalid token format')
      return null
    }

    const [userId, expiresAtStr, providedSignature] = parts
    const expiresAt = parseInt(expiresAtStr, 10)

    // Check expiration
    if (Date.now() > expiresAt) {
      console.warn('[UnsubscribeToken] Token expired')
      return null
    }

    // Verify signature
    const payload = `${userId}:${expiresAt}`
    const secret = getSigningSecret()
    const expectedSignature = createHmac('sha256', secret).update(payload).digest('hex')

    if (providedSignature !== expectedSignature) {
      console.warn('[UnsubscribeToken] Invalid signature')
      return null
    }

    return userId
  } catch (error) {
    console.error('[UnsubscribeToken] Error verifying token:', error)
    return null
  }
}

/**
 * Generate unsubscribe URL for email footer
 * Validates baseUrl to prevent open redirect attacks
 */
export function generateUnsubscribeUrl(userId: string, baseUrl?: string): string {
  const token = generateUnsubscribeToken(userId)

  // Default to production URL
  const defaultUrl: string = process.env.NEXT_PUBLIC_SITE_URL || 'https://pickmyclass.app'

  // Validate provided baseUrl, fall back to default if invalid
  let url: string = defaultUrl
  if (baseUrl) {
    if (isValidBaseUrl(baseUrl)) {
      url = baseUrl
    } else {
      console.warn(`[UnsubscribeToken] Invalid baseUrl rejected: ${baseUrl}`)
    }
  }

  return `${url}/api/unsubscribe?token=${token}`
}
