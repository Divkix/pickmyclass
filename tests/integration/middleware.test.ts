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
    // Recording Database handle handed out by the mocked getDbFromEnv; every
    // authenticated request must create exactly one and share it across the
    // authorization-state and verification reads.
    dbHandle: { execute: mockExecute },
    mockGetDbFromEnv: vi.fn(() => dbHandle),
    mockGetSessionIdentity: vi.fn(),
    mockReadAuthorizationState: vi.fn(),
    mockReadUserVerification: vi.fn(),
    mockRevokeSession: vi.fn(),
  };
});

// Clerk seams — never verify real session tokens or call the Backend API.
vi.mock('@/lib/auth/clerk-session', () => ({
  getSessionIdentity: mockGetSessionIdentity,
  revokeSession: mockRevokeSession,
}));

// Gate read seams; decideGate itself stays real so redirect policy is exercised.
vi.mock('@/lib/auth/authorization-state', () => ({
  readAuthorizationState: mockReadAuthorizationState,
}));

vi.mock('@/lib/db/users', () => ({
  readUserVerification: mockReadUserVerification,
}));

// Request-scoped handle seam: authenticated requests call getDbFromEnv() once.
vi.mock('@/lib/db', () => ({
  getDbFromEnv: mockGetDbFromEnv,
}));

// Import proxy after mocks are registered
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

/** Default happy-path seam wiring: verified, consented regular user. */
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

  it('fast-paths public routes without session cookies before any session or database work', async () => {
    const response = await proxy(createRequest('/'));

    expect(response.status).toBe(200);
    expect(mockGetSessionIdentity).not.toHaveBeenCalled();
    expect(mockGetDbFromEnv).not.toHaveBeenCalled();
    expect(mockReadAuthorizationState).not.toHaveBeenCalled();
    expect(mockReadUserVerification).not.toHaveBeenCalled();
  });

  it('redirects anonymous requests away from protected routes without creating a database handle', async () => {
    const response = await proxy(createRequest('/dashboard'));

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe(`${ORIGIN}/sign-in`);
    expect(mockGetDbFromEnv).not.toHaveBeenCalled();
    expect(mockReadAuthorizationState).not.toHaveBeenCalled();
    expect(mockReadUserVerification).not.toHaveBeenCalled();
  });

  it('allows consented verified users through and shares one handle across both gate reads', async () => {
    seedAuthenticated();

    const response = await proxy(createRequest('/dashboard', '__session=test-clerk-jwt'));

    expect(response.status).toBe(200);
    expect(mockGetDbFromEnv).toHaveBeenCalledTimes(1);
    expect(mockReadAuthorizationState).toHaveBeenCalledTimes(1);
    expect(mockReadUserVerification).toHaveBeenCalledTimes(1);
    // Both reads receive the SAME request-scoped handle (never a second one),
    // the stable user id, and the edge cache flag.
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
