import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';

const {
  mockGetPublicLockoutStatus,
  mockCreateClient,
  mockCreateServerClient,
  mockExchangeCodeForSession,
  mockProfileMaybeSingle,
  mockRpc,
  mockSignOut,
} = vi.hoisted(() => ({
  mockGetPublicLockoutStatus: vi.fn(),
  mockCreateClient: vi.fn(),
  mockCreateServerClient: vi.fn(),
  mockExchangeCodeForSession: vi.fn(),
  mockProfileMaybeSingle: vi.fn(),
  mockRpc: vi.fn(),
  mockSignOut: vi.fn(),
}));

vi.mock('@/lib/auth/login-attempt-policy', () => ({
  loginAttemptPolicy: { getPublicStatus: mockGetPublicLockoutStatus },
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: mockCreateClient,
}));

vi.mock('@supabase/ssr', () => ({
  createServerClient: mockCreateServerClient,
}));

vi.mock('next/headers', () => ({
  cookies: vi.fn(() =>
    Promise.resolve({
      getAll: vi.fn(() => []),
      set: vi.fn(),
    })
  ),
}));

import { POST as postCheckLockout } from '@/app/api/auth/check-lockout/route';
import { POST as postSignout } from '@/app/api/auth/signout/route';
import { GET as authCallback } from '@/app/auth/callback/route';
import { GET as redirectToUniversity } from '@/app/go/[uni]/route';

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

function post(url: string, body: Record<string, JsonValue>): NextRequest {
  return new NextRequest(url, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

function get(url: string): NextRequest {
  return new NextRequest(url);
}

async function json(response: Response) {
  // SAFETY: test helper parses JSON response; shape asserted per test case via property access
  return response.json() as Promise<Record<string, JsonValue>>;
}

describe('misc API routes', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockGetPublicLockoutStatus.mockResolvedValue({
      isLocked: true,
      remainingMinutes: 14,
    });
    mockCreateClient.mockResolvedValue({
      auth: {
        signOut: mockSignOut,
      },
    });
    mockSignOut.mockResolvedValue({ error: null });
    mockExchangeCodeForSession.mockResolvedValue({ error: null });
    mockProfileMaybeSingle.mockResolvedValue({
      data: {
        age_verified_at: '2026-07-12T00:00:00.000Z',
        agreed_to_terms_at: '2026-07-12T00:00:00.000Z',
      },
      error: null,
    });
    mockRpc.mockResolvedValue({ error: null });
    mockCreateServerClient.mockReturnValue({
      auth: {
        exchangeCodeForSession: mockExchangeCodeForSession,
      },
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          maybeSingle: mockProfileMaybeSingle,
        })),
      })),
      rpc: mockRpc,
    });
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  it('validates lockout status input', async () => {
    const response = await postCheckLockout(
      post('https://pickmyclass.app/api/auth/check-lockout', {})
    );
    const data = await json(response);

    expect(response.status).toBe(400);
    expect(data.error).toBe('Invalid input');
  });

  it('returns the lockout status for valid email input', async () => {
    const response = await postCheckLockout(
      post('https://pickmyclass.app/api/auth/check-lockout', {
        email: 'student@example.com',
      })
    );
    const data = await json(response);

    expect(response.status).toBe(200);
    // `attempts` is intentionally excluded from the response (SEC-02 — reduces disclosure)
    expect(data).toEqual({ success: true, isLocked: true, remainingMinutes: 14 });
    expect(mockGetPublicLockoutStatus).toHaveBeenCalledWith('student@example.com');
  });

  it('returns a lockout error when status lookup throws', async () => {
    mockGetPublicLockoutStatus.mockRejectedValueOnce(new Error('database unavailable'));

    const response = await postCheckLockout(
      post('https://pickmyclass.app/api/auth/check-lockout', {
        email: 'student@example.com',
      })
    );
    const data = await json(response);

    expect(response.status).toBe(500);
    expect(data.error).toBe('Failed to check lockout status');
  });

  it('signs users out through the server client', async () => {
    const response = await postSignout();
    const data = await json(response);

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(mockSignOut).toHaveBeenCalled();
  });

  it('exchanges callback codes and redirects to the request origin', async () => {
    const response = await authCallback(
      new Request('https://pickmyclass.app/auth/callback?code=abc&next=/dashboard')
    );

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('https://pickmyclass.app/dashboard');
    expect(mockExchangeCodeForSession).toHaveBeenCalledWith('abc');
    expect(mockProfileMaybeSingle).toHaveBeenCalledOnce();
  });

  it('ignores client-controlled x-forwarded-host when redirecting', async () => {
    const response = await authCallback(
      new Request('https://pickmyclass.app/auth/callback?code=abc&next=/dashboard', {
        headers: { 'x-forwarded-host': 'evil.example.com' },
      })
    );

    // The callback must never redirect to a host from the request headers —
    // that would be an open redirect (host-header injection).
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('https://pickmyclass.app/dashboard');
    expect(mockExchangeCodeForSession).toHaveBeenCalledWith('abc');
  });

  it('records confirmed Google signup consent before redirecting', async () => {
    const response = await authCallback(
      new Request(
        'https://pickmyclass.app/auth/callback?code=abc&consent=confirmed&next=/dashboard'
      )
    );

    expect(response.headers.get('location')).toBe('https://pickmyclass.app/dashboard');
    expect(mockRpc).toHaveBeenCalledWith('accept_terms_and_verify_age');
    expect(mockProfileMaybeSingle).not.toHaveBeenCalled();
  });

  it('gates OAuth accounts that have not recorded consent', async () => {
    mockProfileMaybeSingle.mockResolvedValueOnce({
      data: { age_verified_at: null, agreed_to_terms_at: null },
      error: null,
    });

    const response = await authCallback(
      new Request('https://pickmyclass.app/auth/callback?code=abc&next=/dashboard')
    );

    expect(response.headers.get('location')).toBe(
      'https://pickmyclass.app/consent?next=%2Fdashboard'
    );
  });

  it('keeps users on the consent gate when persistence fails', async () => {
    mockRpc.mockResolvedValueOnce({ error: { message: 'database unavailable' } });

    const response = await authCallback(
      new Request(
        'https://pickmyclass.app/auth/callback?code=abc&consent=confirmed&next=/dashboard'
      )
    );

    expect(response.headers.get('location')).toBe(
      'https://pickmyclass.app/consent?error=save_failed&next=%2Fdashboard'
    );
  });

  it('falls back to login when callback exchange fails or code is missing', async () => {
    mockExchangeCodeForSession.mockResolvedValueOnce({
      error: { message: 'bad code' },
    });

    const response = await authCallback(
      new Request('https://pickmyclass.app/auth/callback?code=bad&next=https://evil.test')
    );

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe(
      'https://pickmyclass.app/login?error=oauth_failed'
    );
  });

  it('redirects ASU short links after sanitizing parameters', async () => {
    const response = await redirectToUniversity(
      get('https://pickmyclass.app/go/asu?classNbr=12x345&term=2261abc'),
      {
        params: Promise.resolve({ uni: 'asu' }),
      }
    );

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe(
      'https://catalog.apps.asu.edu/catalog/classes/classlist?keywords=12345&term=2261'
    );
  });

  it('rejects unsupported or incomplete university short links', async () => {
    const missingParams = await redirectToUniversity(get('https://pickmyclass.app/go/asu'), {
      params: Promise.resolve({ uni: 'asu' }),
    });
    const unsupported = await redirectToUniversity(
      get('https://pickmyclass.app/go/uofa?classNbr=12345&term=2261'),
      { params: Promise.resolve({ uni: 'uofa' }) }
    );

    expect(missingParams.status).toBe(400);
    expect((await json(missingParams)).error).toBe('Missing required parameters');
    expect(unsupported.status).toBe(404);
    expect((await json(unsupported)).error).toBe('University not supported');
  });
});
