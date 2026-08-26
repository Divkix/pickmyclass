import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';

const { mockGetSessionIdentity, mockRevokeSession } = vi.hoisted(() => ({
  mockGetSessionIdentity: vi.fn(),
  mockRevokeSession: vi.fn(),
}));

vi.mock('@/lib/auth/clerk-session', () => ({
  getSessionIdentity: mockGetSessionIdentity,
  revokeSession: mockRevokeSession,
}));

import { POST as postSignout } from '@/app/api/auth/signout/route';
import { GET as redirectToUniversity } from '@/app/go/[uni]/route';

function get(url: string): NextRequest {
  return new NextRequest(url);
}

async function json(response: Response) {
  // SAFETY: test helper parses JSON response; shape asserted per test case via property access
  return response.json() as Promise<Record<string, unknown>>;
}

describe('misc API routes', () => {
  let errorSpy: { mockRestore: () => void };

  beforeEach(() => {
    vi.clearAllMocks();
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockRevokeSession.mockResolvedValue(undefined);
    // Default identity carries the session the route revokes
    mockGetSessionIdentity.mockResolvedValue({
      userId: 'user-1',
      clerkUserId: 'clerk_1',
      sessionId: 'sess_1',
    });
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  it('signs users out by revoking the Clerk session and clearing cookies', async () => {
    const req = new NextRequest('https://pickmyclass.app/api/auth/signout', {
      method: 'POST',
    });
    const response = await postSignout(req);
    const data = await json(response);

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(mockRevokeSession).toHaveBeenCalledWith('sess_1');
    const setCookie = response.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain('__session=');
  });

  it('still returns 200 when session revocation fails', async () => {
    mockRevokeSession.mockRejectedValue(new Error('clerk unreachable'));
    const req = new NextRequest('https://pickmyclass.app/api/auth/signout', {
      method: 'POST',
    });
    const response = await postSignout(req);

    expect(response.status).toBe(200);
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
