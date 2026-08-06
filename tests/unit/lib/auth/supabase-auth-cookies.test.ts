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

  it('detects chunked Supabase auth cookies', () => {
    expect(isSupabaseAuthCookieName('sb-proj-ref-auth-token.0')).toBe(true);
    expect(isSupabaseAuthCookieName('sb-proj-ref-auth-token.1')).toBe(true);
    expect(hasSupabaseAuthCookies(['foo', 'sb-test-auth-token.0'])).toBe(true);
    expect(hasSupabaseAuthCookiesInHeader('foo=1; sb-test-auth-token.0=value')).toBe(true);
  });

  it('detects auth cookies from iterables and headers', () => {
    expect(hasSupabaseAuthCookies(['foo', 'sb-test-auth-token'])).toBe(true);
    expect(hasSupabaseAuthCookies(['foo', 'bar'])).toBe(false);
    expect(hasSupabaseAuthCookiesInHeader('foo=1; sb-test-auth-token=value')).toBe(true);
    expect(hasSupabaseAuthCookiesInHeader('foo=1; bar=2')).toBe(false);
  });
});
