import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import type { AuthorizationState } from '@/lib/auth/authorization-state';
import type { SessionIdentity } from '@/lib/auth/clerk-session';
import type { UserVerificationState } from '@/lib/db/users';

const {
  dbHandle,
  mockGetDbFromEnv,
  mockGetSessionIdentity,
  mockReadAuthorizationState,
  mockReadUserVerification,
  mockRevokeSession,
} = vi.hoisted(() => {
  const mockExecute = vi.fn();

  return {
    dbHandle: { execute: mockExecute },
    mockGetDbFromEnv: vi.fn(() => dbHandle),
    mockGetSessionIdentity: vi.fn(),
    mockReadAuthorizationState: vi.fn(),
    mockReadUserVerification: vi.fn(),
    mockRevokeSession: vi.fn(),
  };
});

vi.mock('@/lib/auth/clerk-session', () => ({
  getSessionIdentity: mockGetSessionIdentity,
  revokeSession: mockRevokeSession,
}));

vi.mock('@/lib/auth/authorization-state', () => ({
  readAuthorizationState: mockReadAuthorizationState,
}));

vi.mock('@/lib/db/users', () => ({
  readUserVerification: mockReadUserVerification,
}));

vi.mock('@/lib/db', () => ({
  getDbFromEnv: mockGetDbFromEnv,
}));

import proxy from '@/proxy';

const ORIGIN = 'http://localhost:3000';

const IDENTITY = { userId: 'user-1', clerkUserId: 'clerk_1', sessionId: 'sess_1' };

const VERIFIED = { email: 'test@example.com', email_confirmed_at: '2026-01-01T00:00:00Z' };

const UNVERIFIED = { email: 'unverified@example.com', email_confirmed_at: null };

const CONSENTED = { is_admin: false, is_disabled: false, has_consent: true };

const UNCONSENTED = { is_admin: false, is_disabled: false, has_consent: false };

const ADMIN = { is_admin: true, is_disabled: false, has_consent: true };

const DISABLED = { is_admin: false, is_disabled: true, has_consent: true };

function createRequest(pathname: string, cookie?: string): NextRequest {
  return new NextRequest(new URL(pathname, ORIGIN), {
    headers: new Headers(cookie ? { cookie } : {}),
  });
}

function cspDirective(csp: string | null, name: string): string {
  return (
    (csp ?? '')
      .split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${name} `)) ?? ''
  );
}

function scriptSrcOf(csp: string | null): string {
  return cspDirective(csp, 'script-src');
}

function seedAuthenticated(
  identity: SessionIdentity = IDENTITY,
  verification: UserVerificationState = VERIFIED,
  authState: AuthorizationState = CONSENTED
): void {
  mockGetSessionIdentity.mockResolvedValue(identity);
  mockReadUserVerification.mockResolvedValue(verification);
  mockReadAuthorizationState.mockResolvedValue(authState);
}

describe('proxy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('allows the Turnstile script and Clerk fraud hosts that sign-up loads', async () => {
    const response = await proxy(createRequest('/sign-up'));
    const csp = response.headers.get('content-security-policy');

    const scriptSrc = cspDirective(csp, 'script-src');
    const frameSrc = cspDirective(csp, 'frame-src');
    const connectSrc = cspDirective(csp, 'connect-src');

    expect(scriptSrc).toContain('https://challenges.cloudflare.com');
    expect(scriptSrc).toContain('https://*.protect.clerk.com');
    expect(scriptSrc).not.toContain('https://*.protect.clerk.com:*');
    expect(frameSrc).toContain('https://challenges.cloudflare.com');
    expect(frameSrc).toContain('https://*.protect.clerk.com');
    expect(frameSrc).not.toContain('https://*.protect.clerk.com:*');
    expect(connectSrc).toContain('https://challenges.cloudflare.com');
    expect(connectSrc).toContain('https://*.protect.clerk.com:*');
  });

  it('fast-paths public routes without session cookies before any session or database work', async () => {
    const response = await proxy(createRequest('/'));

    expect(response.status).toBe(200);
    expect(mockGetSessionIdentity).not.toHaveBeenCalled();
    expect(mockGetDbFromEnv).not.toHaveBeenCalled();
    expect(mockReadAuthorizationState).not.toHaveBeenCalled();
    expect(mockReadUserVerification).not.toHaveBeenCalled();
  });

  it('lets cached public pages run inline framework scripts without an unusable nonce', async () => {
    const response = await proxy(createRequest('/'));
    const scriptSrc = scriptSrcOf(response.headers.get('content-security-policy'));

    expect(scriptSrc).toContain("'unsafe-inline'");
    expect(scriptSrc).not.toContain("'nonce-");
    expect(scriptSrc).not.toContain("'sha256-");
  });

  it('redirects anonymous requests away from protected routes without creating a database handle', async () => {
    const response = await proxy(createRequest('/dashboard'));

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe(`${ORIGIN}/sign-in`);
    expect(mockGetDbFromEnv).not.toHaveBeenCalled();
    expect(mockReadAuthorizationState).not.toHaveBeenCalled();
    expect(mockReadUserVerification).not.toHaveBeenCalled();
  });

  it('gives session requests a fresh script nonce instead of inline allowance', async () => {
    seedAuthenticated();

    const first = await proxy(createRequest('/dashboard', '__session=token'));
    const second = await proxy(createRequest('/dashboard', '__session=token'));
    const firstScriptSrc = scriptSrcOf(first.headers.get('content-security-policy'));

    expect(firstScriptSrc).toMatch(/'nonce-[0-9a-f-]{36}'/);
    expect(firstScriptSrc).not.toContain("'unsafe-inline'");
    expect(firstScriptSrc).not.toBe(scriptSrcOf(second.headers.get('content-security-policy')));
  });

  it('allows consented verified users through and shares one handle across both gate reads', async () => {
    seedAuthenticated();

    const response = await proxy(createRequest('/dashboard', '__session=test-clerk-jwt'));

    expect(response.status).toBe(200);
    expect(mockGetDbFromEnv).toHaveBeenCalledTimes(1);
    expect(mockReadAuthorizationState).toHaveBeenCalledTimes(1);
    expect(mockReadUserVerification).toHaveBeenCalledTimes(1);
    expect(mockReadAuthorizationState.mock.calls[0][0]).toBe(dbHandle);
    expect(mockReadUserVerification.mock.calls[0][0]).toBe(dbHandle);
    expect(mockReadAuthorizationState.mock.calls[0][1]).toBe('user-1');
    expect(mockReadUserVerification.mock.calls[0][1]).toBe('user-1');
    expect(mockReadAuthorizationState.mock.calls[0][2]).toEqual({ cache: true });
    expect(mockReadUserVerification.mock.calls[0][2]).toEqual({ cache: true });
  });

  it('routes verified users without recorded consent to /consent preserving the next path', async () => {
    seedAuthenticated(IDENTITY, VERIFIED, UNCONSENTED);

    const response = await proxy(createRequest('/dashboard?tab=watching', '__session=t'));

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe(
      `${ORIGIN}/consent?next=${encodeURIComponent('/dashboard?tab=watching')}`
    );
  });

  it('redirects users with unconfirmed emails to sign-in', async () => {
    seedAuthenticated(IDENTITY, UNVERIFIED, CONSENTED);

    const response = await proxy(createRequest('/dashboard', '__session=test-clerk-jwt'));

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe(`${ORIGIN}/sign-in`);
  });

  it('revokes the session, clears Clerk cookies, and redirects disabled accounts', async () => {
    seedAuthenticated(IDENTITY, VERIFIED, DISABLED);

    const response = await proxy(createRequest('/dashboard', '__session=test-clerk-jwt'));

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe(`${ORIGIN}/sign-in?error=account_disabled`);
    expect(mockRevokeSession).toHaveBeenCalledTimes(1);
    expect(mockRevokeSession).toHaveBeenCalledWith('sess_1');
    const setCookie = response.headers.getSetCookie().join('\n');

    for (const name of ['__session', '__client_uat']) {
      expect(setCookie).toContain(`${name}=`);
    }
  });

  it('still signs disabled accounts out when session revocation fails', async () => {
    seedAuthenticated(IDENTITY, VERIFIED, DISABLED);
    mockRevokeSession.mockRejectedValueOnce(new Error('backend api down'));

    const response = await proxy(createRequest('/dashboard', '__session=test-clerk-jwt'));

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe(`${ORIGIN}/sign-in?error=account_disabled`);
    expect(response.headers.get('set-cookie')).toContain('__session=');
  });

  it('redirects an unknown authorization read without revoking the session', async () => {
    mockGetSessionIdentity.mockResolvedValue(IDENTITY);
    mockReadUserVerification.mockResolvedValue(VERIFIED);
    mockReadAuthorizationState.mockResolvedValue(null);

    const response = await proxy(
      createRequest('/dashboard?tab=watching', '__session=test-clerk-jwt')
    );

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe(
      `${ORIGIN}/auth/post-oauth?next=${encodeURIComponent('/dashboard?tab=watching')}`
    );
    expect(mockRevokeSession).not.toHaveBeenCalled();
    expect(response.headers.getSetCookie().join('\n')).not.toContain('__session=');
  });

  it('sends verified admins hitting sign-in to /admin', async () => {
    seedAuthenticated(IDENTITY, VERIFIED, ADMIN);

    const response = await proxy(createRequest('/sign-in', '__session=test-clerk-jwt'));

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe(`${ORIGIN}/admin`);
  });

  it('sends consented users who revisit /consent to their role landing page', async () => {
    seedAuthenticated(IDENTITY, VERIFIED, CONSENTED);

    const response = await proxy(createRequest('/consent', '__session=test-clerk-jwt'));

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe(`${ORIGIN}/dashboard`);
  });

  it('passes unknown paths through so the app can answer them itself', async () => {
    seedAuthenticated();

    const request = createRequest('/nonexistent-page', '__session=test-clerk-jwt');
    const response = await proxy(request);

    expect(response.status).toBe(200);
  });
});
