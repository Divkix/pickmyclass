/**
 * Disposable email domain checker
 *
 * Uses a KV-backed blocklist of disposable domains, synced daily from GitHub.
 * Hard-coded trusted domain allowlist skips KV checks for major providers.
 * Fails open on any infrastructure failure — email verification is the safety net.
 */

import { TtlCache } from '@/lib/cache/ttl-cache';
import { DISPOSABLE_EMAIL_CACHE_TTL_MS } from '@/lib/config';
import { log } from '@/lib/log';
export interface DisposableCheckResult {
  disposable: boolean;
}

const TRUSTED_DOMAINS: ReadonlySet<string> = new Set([
  // Google
  'gmail.com',
  'googlemail.com',
  // Microsoft
  'outlook.com',
  'hotmail.com',
  'live.com',
  'msn.com',
  // Yahoo
  'yahoo.com',
  'ymail.com',
  // Apple
  'icloud.com',
  'me.com',
  'mac.com',
  // Others
  'aol.com',
  'protonmail.com',
  'proton.me',
  'tutanota.com',
  'tutamail.com',
  'zoho.com',
  'fastmail.com',
  'hey.com',
  // University
  'asu.edu',
  'gmail.asu.edu',
  // ISP
  'comcast.net',
  'att.net',
  'verizon.net',
]);

/**
 * Extract domain from email address.
 * Returns null for invalid formats — let Zod handle format validation.
 */
export function extractDomain(email: string): string | null {
  const parts = email.split('@');
  if (parts.length !== 2) return null;

  const [local, rawDomain] = parts;
  if (!local || local.length === 0) return null;

  const domain = rawDomain.trim().toLowerCase();
  if (domain.length === 0) return null;

  return domain;
}

export function isTrustedDomain(domain: string): boolean {
  return TRUSTED_DOMAINS.has(domain);
}

// Module-level cache for domain blocklist (reuses shared TtlCache)
const disposableDomainsCache = new TtlCache<Set<string>>(DISPOSABLE_EMAIL_CACHE_TTL_MS);
const DISPOSABLE_CACHE_KEY = 'blocklist';

/**
 * Reset the module-level domain cache.
 * Exposed for testing only.
 */
export function _resetCache(): void {
  disposableDomainsCache.clear();
}

/**
 * Check if an email address uses a disposable domain.
 *
 * Lookup flow:
 * 1. Extract domain → null returns { disposable: false } (let Zod handle format)
 * 2. Check TRUSTED_DOMAINS Set → early return, zero KV calls
 * 3. If KV is null → fail open
 * 4. Load domain list from KV into cached Set (1hr TTL)
 * 5. Check cachedDomains.has(domain) → return result
 *
 * Fails open on any error. Email verification is the safety net.
 */
export async function isDisposableEmail(
  email: string,
  kv: KVNamespace | null
): Promise<DisposableCheckResult> {
  const domain = extractDomain(email);
  if (!domain) return { disposable: false };

  // Trusted domains skip KV entirely
  if (TRUSTED_DOMAINS.has(domain)) return { disposable: false };

  // No KV binding → fail open
  if (!kv) return { disposable: false };

  try {
    let domains = disposableDomainsCache.get(DISPOSABLE_CACHE_KEY);
    if (!domains) {
      const raw = await kv.get('disposable-domains');
      if (!raw) return { disposable: false };

      const domainsList: string[] = JSON.parse(raw);
      domains = new Set(domainsList);
      disposableDomainsCache.set(DISPOSABLE_CACHE_KEY, domains);
    }

    return { disposable: domains.has(domain) };
  } catch (error) {
    log('DisposableCheck').error('KV lookup failed, failing open:', error);
    return { disposable: false };
  }
}
