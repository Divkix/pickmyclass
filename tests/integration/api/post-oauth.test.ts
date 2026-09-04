import { type SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test';

const {
  dbHandle,
  mockExecute,
  mockGetDbFromEnv,
  mockGetSessionIdentity,
  mockRepairUserMirror,
  mockInvalidateAuthorizationState,
} = vi.hoisted(() => {
  const mockExecute = vi.fn();
  return {
    dbHandle: { execute: mockExecute },
    mockExecute,
    mockGetDbFromEnv: vi.fn(() => dbHandle),
    mockGetSessionIdentity: vi.fn(),
    mockRepairUserMirror: vi.fn(),
    mockInvalidateAuthorizationState: vi.fn(),
  };
});

vi.mock('@/lib/auth/clerk-session', () => ({
  getSessionIdentity: mockGetSessionIdentity,
}));

vi.mock('@/lib/db/users', () => ({
  repairUserMirror: mockRepairUserMirror,
}));

vi.mock('@/lib/db', () => ({
  getDbFromEnv: mockGetDbFromEnv,
}));

vi.mock('@/lib/auth/authorization-state', () => ({
  invalidateAuthorizationState: mockInvalidateAuthorizationState,
}));

import { GET } from '@/app/auth/post-oauth/route';

const ORIGIN = 'https://pickmyclass.app';
const IDENTITY = { userId: 'user-1', clerkUserId: 'clerk_user_1', sessionId: 'sess_1' };

function getRequest(search = '', headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(`${ORIGIN}/auth/post-oauth${search}`, { headers });
}

function locationOf(response: Response): string {
  const location = response.headers.get('location');
  expect(location, 'expected a redirect response').not.toBeNull();
  return location as string;
}

describe('GET /auth/post-oauth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSessionIdentity.mockResolvedValue(IDENTITY);
    mockRepairUserMirror.mockResolvedValue({ hasConsent: false });
    mockExecute.mockResolvedValue([]);
  });

  it('redirects unauthenticated requests to sign-in with oauth_failed without touching the mirror', async () => {
    mockGetSessionIdentity.mockResolvedValueOnce(null);

    const response = await GET(getRequest());

    expect(locationOf(response)).toBe(`${ORIGIN}/sign-in?error=oauth_failed`);
    expect(mockGetDbFromEnv).not.toHaveBeenCalled();
    expect(mockRepairUserMirror).not.toHaveBeenCalled();
    expect(mockExecute).not.toHaveBeenCalled();
    expect(mockInvalidateAuthorizationState).not.toHaveBeenCalled();
  });

  it('creates exactly one database handle per request', async () => {
    mockRepairUserMirror.mockResolvedValueOnce({ hasConsent: true });

    const response = await GET(getRequest('?next=/dashboard'));

    expect(locationOf(response)).toBe(`${ORIGIN}/dashboard`);
    expect(mockGetDbFromEnv).toHaveBeenCalledTimes(1);
  });

  it('repairs the mirror once with the request-scoped handle and session identity', async () => {
    await GET(getRequest('?next=/dashboard'));

    expect(mockRepairUserMirror).toHaveBeenCalledTimes(1);
    expect(mockRepairUserMirror).toHaveBeenCalledWith(dbHandle, 'user-1', 'clerk_user_1');
  });

  it('maps a null repair (no email on Clerk user) to the save_failed consent redirect', async () => {
    mockRepairUserMirror.mockResolvedValueOnce(null);

    const response = await GET(getRequest('?next=/dashboard'));

    expect(locationOf(response)).toBe(`${ORIGIN}/consent?error=save_failed&next=%2Fdashboard`);
    expect(mockExecute).not.toHaveBeenCalled();
    expect(mockInvalidateAuthorizationState).not.toHaveBeenCalled();
  });

  it('maps a thrown repair failure to the oauth_failed sign-in redirect', async () => {
    mockRepairUserMirror.mockRejectedValueOnce(new Error('mirror upsert failed'));

    const response = await GET(getRequest('?next=/dashboard'));

    expect(locationOf(response)).toBe(`${ORIGIN}/sign-in?error=oauth_failed`);
    expect(mockExecute).not.toHaveBeenCalled();
    expect(mockInvalidateAuthorizationState).not.toHaveBeenCalled();
  });

  it('routes users without recorded consent to /consent using the repaired flag instead of extra SQL', async () => {
    mockRepairUserMirror.mockResolvedValueOnce({ hasConsent: false });

    const response = await GET(getRequest('?next=/dashboard'));

    expect(locationOf(response)).toBe(`${ORIGIN}/consent?next=%2Fdashboard`);
    expect(mockExecute).not.toHaveBeenCalled();
    expect(mockInvalidateAuthorizationState).not.toHaveBeenCalled();
  });

  it('sends consented users straight to the safe next destination', async () => {
    mockRepairUserMirror.mockResolvedValueOnce({ hasConsent: true });

    const response = await GET(getRequest('?next=/dashboard'));

    expect(locationOf(response)).toBe(`${ORIGIN}/dashboard`);
    expect(mockExecute).not.toHaveBeenCalled();
    expect(mockInvalidateAuthorizationState).not.toHaveBeenCalled();
  });

  it('records confirmed consent via one bound RPC, then invalidates authorization state before redirecting', async () => {
    mockRepairUserMirror.mockResolvedValueOnce({ hasConsent: false });

    const response = await GET(getRequest('?next=/dashboard&consent=confirmed'));

    expect(mockExecute).toHaveBeenCalledTimes(1);
    const query = mockExecute.mock.calls[0][0] as SQL;
    expect(new PgDialect().sqlToQuery(query).sql.replace(/\s+/g, ' ').trim()).toBe(
      'SELECT public.accept_terms_and_verify_age($1::text)'
    );
    expect(new PgDialect().sqlToQuery(query).params).toEqual(['user-1']);
    expect(mockInvalidateAuthorizationState).toHaveBeenCalledTimes(1);
    expect(mockInvalidateAuthorizationState).toHaveBeenCalledWith('user-1');
    expect(mockExecute.mock.invocationCallOrder[0]).toBeLessThan(
      mockInvalidateAuthorizationState.mock.invocationCallOrder[0]
    );
    expect(locationOf(response)).toBe(`${ORIGIN}/dashboard`);
  });

  it('does not invalidate authorization state when the consent RPC fails and falls back to save_failed', async () => {
    mockExecute.mockRejectedValueOnce(new Error('database unavailable'));

    const response = await GET(getRequest('?next=/dashboard&consent=confirmed'));

    expect(locationOf(response)).toBe(`${ORIGIN}/consent?error=save_failed&next=%2Fdashboard`);
    expect(mockInvalidateAuthorizationState).not.toHaveBeenCalled();
  });

  it('sanitizes protocol-relative and backslash next values down to the safe fallback', async () => {
    mockRepairUserMirror.mockResolvedValue({ hasConsent: true });

    const protocolRelative = await GET(
      getRequest(`?next=${encodeURIComponent('//evil.example/pwn')}`)
    );
    const backslash = await GET(getRequest(`?next=${encodeURIComponent('/\\evil.example/pwn')}`));

    expect(locationOf(protocolRelative)).toBe(`${ORIGIN}/`);
    expect(locationOf(backslash)).toBe(`${ORIGIN}/`);
  });

  it('resolves every redirect against the request origin, ignoring a forwarded host header', async () => {
    const forwardedHost = { 'x-forwarded-host': 'evil.example' };

    mockGetSessionIdentity.mockResolvedValueOnce(null);
    const unauthenticated = await GET(getRequest('', forwardedHost));

    mockRepairUserMirror.mockResolvedValue({ hasConsent: false });
    const consentGate = await GET(getRequest('?next=/dashboard', forwardedHost));

    mockRepairUserMirror.mockResolvedValue({ hasConsent: true });
    const success = await GET(getRequest('?next=/dashboard', forwardedHost));

    expect(locationOf(unauthenticated)).toBe(`${ORIGIN}/sign-in?error=oauth_failed`);
    expect(locationOf(consentGate)).toBe(`${ORIGIN}/consent?next=%2Fdashboard`);
    expect(locationOf(success)).toBe(`${ORIGIN}/dashboard`);
    for (const response of [unauthenticated, consentGate, success]) {
      expect(locationOf(response)).toMatch(/^https:\/\/pickmyclass\.app\//);
      expect(locationOf(response)).not.toContain('evil.example');
    }
  });
});
