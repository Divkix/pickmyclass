import { describe, expect, it } from 'vitest';
import {
  hasSupabaseAuthCookies,
  hasSupabaseAuthCookiesInHeader,
  isSupabaseAuthCookieName,
} from '@/lib/auth/supabase-auth-cookies';
import {
  buildPublicEdgeCacheKey,
  isPublicEdgeCacheablePath,
  publicEdgeCacheControl,
  publicEdgeCdnCacheControl,
} from '@/lib/cache/public-edge-cache';

describe('supabase auth cookie helpers', () => {
  it('detects legacy auth cookies', () => {
    expect(isSupabaseAuthCookieName('sb-access-token')).toBe(true);
    expect(isSupabaseAuthCookieName('sb-refresh-token')).toBe(true);
  });

  it('detects project-scoped auth cookies', () => {
    expect(isSupabaseAuthCookieName('sb-project-ref-auth-token')).toBe(true);
    expect(isSupabaseAuthCookieName('sb-project-ref-other-cookie')).toBe(false);
  });

  it('detects auth cookies from iterables and headers', () => {
    expect(hasSupabaseAuthCookies(['foo', 'sb-test-auth-token'])).toBe(true);
    expect(hasSupabaseAuthCookies(['foo', 'bar'])).toBe(false);
    expect(hasSupabaseAuthCookiesInHeader('foo=1; sb-test-auth-token=value')).toBe(true);
    expect(hasSupabaseAuthCookiesInHeader('foo=1; bar=2')).toBe(false);
  });
});

describe('public edge cache helpers', () => {
  it('only allows the intended public routes', () => {
    expect(isPublicEdgeCacheablePath('/')).toBe(true);
    expect(isPublicEdgeCacheablePath('/legal/privacy')).toBe(true);
    expect(isPublicEdgeCacheablePath('/dashboard')).toBe(false);
    expect(isPublicEdgeCacheablePath('/login')).toBe(false);
  });

  it('normalizes cache keys to pathname-only GET requests', () => {
    const cacheKey = buildPublicEdgeCacheKey(
      new Request('https://pickmyclass.app/legal?utm_source=test', { method: 'HEAD' })
    );

    expect(cacheKey.method).toBe('GET');
    expect(cacheKey.url).toBe('https://pickmyclass.app/legal');
  });

  it('exports the intended cache policies', () => {
    expect(publicEdgeCacheControl).toBe('public, max-age=0, must-revalidate');
    expect(publicEdgeCdnCacheControl).toBe('public, s-maxage=3600, stale-while-revalidate=86400');
  });
});
