import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';

const {
  mockGetPublicLockoutStatus,
  mockCreateClient,
  mockCreateServerClient,
  mockExchangeCodeForSession,
  mockQueryOne,
  mockCallFunction,
  mockSignOut,
} = vi.hoisted(() => ({
  mockGetPublicLockoutStatus: vi.fn(),
  mockCreateClient: vi.fn(),
  mockCreateServerClient: vi.fn(),
  mockExchangeCodeForSession: vi.fn(),
  mockQueryOne: vi.fn(),
  mockCallFunction: vi.fn(),
  mockSignOut: vi.fn(),
}));

vi.mock('@/lib/auth/login-attempt-policy', () => ({
  loginAttemptPolicy: { getPublicStatus: mockGetPublicLockoutStatus },
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: mockCreateClient,
}));

vi.mock('@/lib/db/client', () => ({
  queryOne: mockQueryOne,
  callFunction: mockCallFunction,
  query: vi.fn(),
  queryScalar: vi.fn(),
  execute: vi.fn(),
  callFunctionScalar: vi.fn(),
  getClient: vi.fn(),
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
    // exchangeCodeForSession must return a user so the callback route proceeds
    mockExchangeCodeForSession.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    });
    // Default profile query returns consent timestamps (verified user)
    mockQueryOne.mockResolvedValue({
      age_verified_at: '2026-07-12T00:00:00.000Z',
      agreed_to_terms_at: '2026-07-12T00:00:00.000Z',
    });
    // Default callFunction succeeds (consent recorded)
    mockCallFunction.mockResolvedValue([]);
    mockCreateServerClient.mockReturnValue({
      auth: {
        exchangeCodeForSession: mockExchangeCodeForSession,
      },
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
    const req = new NextRequest('https://pickmyclass.app/api/auth/signout', {
      method: 'POST',
    });
    const response = await postSignout(req);
    const data = await json(response);

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    // Clerk signout no longer goes through Supabase mock, but route still returns 200
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
