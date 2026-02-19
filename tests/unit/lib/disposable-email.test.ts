import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  _resetCache,
  extractDomain,
  isDisposableEmail,
  isTrustedDomain,
} from '@/lib/auth/disposable-email';

describe('extractDomain', () => {
  it('should extract domain from a valid email', () => {
    expect(extractDomain('user@gmail.com')).toBe('gmail.com');
  });

  it('should extract domain from email with alias', () => {
    expect(extractDomain('user+tag@gmail.com')).toBe('gmail.com');
  });

  it('should lowercase the domain', () => {
    expect(extractDomain('USER@GMAIL.COM')).toBe('gmail.com');
  });

  it('should return null for multiple @ symbols', () => {
    expect(extractDomain('user@@gmail.com')).toBeNull();
  });

  it('should return null for email without @', () => {
    expect(extractDomain('usergmail.com')).toBeNull();
  });

  it('should return null for empty string', () => {
    expect(extractDomain('')).toBeNull();
  });

  it('should return null for just @', () => {
    expect(extractDomain('@')).toBeNull();
  });

  it('should return null when there is no domain after @', () => {
    expect(extractDomain('user@')).toBeNull();
  });

  it('should trim whitespace from domain', () => {
    expect(extractDomain('user@ gmail.com ')).toBe('gmail.com');
  });

  it('should handle subdomain email', () => {
    expect(extractDomain('user@sub.domain.com')).toBe('sub.domain.com');
  });

  it('should return null when there is no local part before @', () => {
    expect(extractDomain('@gmail.com')).toBeNull();
  });
});

describe('isTrustedDomain', () => {
  it.each([
    'gmail.com',
    'googlemail.com',
    'outlook.com',
    'hotmail.com',
    'live.com',
    'msn.com',
    'yahoo.com',
    'ymail.com',
    'icloud.com',
    'me.com',
    'mac.com',
    'aol.com',
    'protonmail.com',
    'proton.me',
    'tutanota.com',
    'tutamail.com',
    'zoho.com',
    'fastmail.com',
    'hey.com',
    'asu.edu',
    'gmail.asu.edu',
    'comcast.net',
    'att.net',
    'verizon.net',
  ])('should return true for trusted domain: %s', (domain) => {
    expect(isTrustedDomain(domain)).toBe(true);
  });

  it('should return false for unknown domain', () => {
    expect(isTrustedDomain('randomdomain.com')).toBe(false);
  });

  it('should return false for known disposable domain', () => {
    expect(isTrustedDomain('mailinator.com')).toBe(false);
  });

  it('should return false for empty string', () => {
    expect(isTrustedDomain('')).toBe(false);
  });
});

describe('isDisposableEmail', () => {
  afterEach(() => {
    _resetCache();
  });

  function createMockKV(domains: string[]) {
    return {
      get: vi.fn(async (key: string) => {
        if (key === 'disposable-domains') return JSON.stringify(domains);
        return null;
      }),
      put: vi.fn(),
      delete: vi.fn(),
      list: vi.fn(),
      getWithMetadata: vi.fn(),
    } as unknown as KVNamespace;
  }

  it('should detect disposable email domain', async () => {
    const kv = createMockKV(['mailinator.com', 'tempmail.com']);
    const result = await isDisposableEmail('user@mailinator.com', kv);
    expect(result.disposable).toBe(true);
  });

  it('should return false for clean domain', async () => {
    const kv = createMockKV(['mailinator.com']);
    const result = await isDisposableEmail('user@company.com', kv);
    expect(result.disposable).toBe(false);
  });

  it('should skip KV for trusted domains', async () => {
    const kv = createMockKV(['gmail.com']); // even if gmail is in blocklist
    const result = await isDisposableEmail('user@gmail.com', kv);
    expect(result.disposable).toBe(false);
    expect(kv.get).not.toHaveBeenCalled();
  });

  it('should fail open when KV is null', async () => {
    const result = await isDisposableEmail('user@mailinator.com', null);
    expect(result.disposable).toBe(false);
  });

  it('should fail open when KV throws', async () => {
    const kv = {
      get: vi.fn().mockRejectedValue(new Error('KV unavailable')),
    } as unknown as KVNamespace;
    const result = await isDisposableEmail('user@mailinator.com', kv);
    expect(result.disposable).toBe(false);
  });

  it('should fail open when KV returns null (empty store)', async () => {
    const kv = {
      get: vi.fn().mockResolvedValue(null),
    } as unknown as KVNamespace;
    const result = await isDisposableEmail('user@mailinator.com', kv);
    expect(result.disposable).toBe(false);
  });

  it('should return false for invalid email format', async () => {
    const kv = createMockKV(['mailinator.com']);
    const result = await isDisposableEmail('not-an-email', kv);
    expect(result.disposable).toBe(false);
  });

  it('should cache domain list and not re-read KV on second call', async () => {
    const kv = createMockKV(['mailinator.com']);

    await isDisposableEmail('user@mailinator.com', kv);
    await isDisposableEmail('user2@mailinator.com', kv);

    // KV.get should only be called once due to caching
    expect(kv.get).toHaveBeenCalledTimes(1);
  });

  it('should re-read KV after cache expires', async () => {
    const kv = createMockKV(['mailinator.com']);

    await isDisposableEmail('user@mailinator.com', kv);

    // Expire the cache by resetting
    _resetCache();

    await isDisposableEmail('user2@mailinator.com', kv);

    // Should have read KV twice
    expect(kv.get).toHaveBeenCalledTimes(2);
  });
});
