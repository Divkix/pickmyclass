import { describe, expect, it } from 'vite-plus/test';
import {
  hasSupabaseAuthCookies,
  hasSupabaseAuthCookiesInHeader,
  isSupabaseAuthCookieName,
} from '@/lib/auth/supabase-auth-cookies';

describe('supabase auth cookie helpers', () => {
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
