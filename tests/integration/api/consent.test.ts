import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test';

const {
  mockRequireUser,
  mockRepairUserMirror,
  mockCallFunction,
  mockInvalidateAuthorizationState,
} = vi.hoisted(() => ({
  mockRequireUser: vi.fn(),
  mockRepairUserMirror: vi.fn(),
  mockCallFunction: vi.fn(),
  mockInvalidateAuthorizationState: vi.fn(),
}));

// Clerk identity seam: POST -> requireUser -> UnauthorizedError on bad sessions.
vi.mock('@/lib/auth/require-user', () => {
  class UnauthorizedError extends Error {
    constructor(message = 'Unauthorized') {
      super(message);
      this.name = 'UnauthorizedError';
    }
  }
  return { requireUser: mockRequireUser, UnauthorizedError };
});

// Mirror/profile ownership lives in lib/db/users; the consent route only sees
// repairUserMirror's tri-state result (profile | null when no primary email).
vi.mock('@/lib/db/users', () => ({
  repairUserMirror: mockRepairUserMirror,
}));

vi.mock('@/lib/db/client', () => ({
  callFunction: mockCallFunction,
}));

vi.mock('@/lib/auth/authorization-state', () => ({
  invalidateAuthorizationState: mockInvalidateAuthorizationState,
}));

import { POST } from '@/app/api/auth/consent/route';
import { UnauthorizedError } from '@/lib/auth/require-user';

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

function request(body: Record<string, JsonValue>): NextRequest {
  return new NextRequest('https://pickmyclass.app/api/auth/consent', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

const CONSENT_BODY = { ageVerified: true, agreedToTerms: true };

describe('POST /api/auth/consent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireUser.mockResolvedValue({
      user: { userId: 'user-1', clerkUserId: 'clerk-1' },
    });
    mockRepairUserMirror.mockResolvedValue({ hasConsent: false });
    mockCallFunction.mockResolvedValue([]);
  });

  it('rejects requests that do not explicitly confirm both statements', async () => {
    const response = await POST(request({ ageVerified: true, agreedToTerms: false }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      error: 'Invalid input',
    });
    expect(mockCallFunction).not.toHaveBeenCalled();
    expect(mockInvalidateAuthorizationState).not.toHaveBeenCalled();
  });

  it('requires an authenticated user', async () => {
    mockRequireUser.mockRejectedValueOnce(new UnauthorizedError());

    const response = await POST(request(CONSENT_BODY));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      error: 'Unauthorized',
    });
    expect(mockRepairUserMirror).not.toHaveBeenCalled();
    expect(mockCallFunction).not.toHaveBeenCalled();
    expect(mockInvalidateAuthorizationState).not.toHaveBeenCalled();
  });

  it('returns setup-incomplete without recording consent when mirror repair finds no email', async () => {
    mockRepairUserMirror.mockResolvedValueOnce(null);

    const response = await POST(request(CONSENT_BODY));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      error: 'Account setup incomplete — please try again in a moment',
    });
    expect(mockRepairUserMirror).toHaveBeenCalledWith('user-1', 'clerk-1');
    expect(mockCallFunction).not.toHaveBeenCalled();
    expect(mockInvalidateAuthorizationState).not.toHaveBeenCalled();
  });

  it('does not invalidate access state when mirror repair fails', async () => {
    mockRepairUserMirror.mockRejectedValueOnce(new Error('clerk unavailable'));

    const response = await POST(request(CONSENT_BODY));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      error: 'Could not save consent',
    });
    expect(mockCallFunction).not.toHaveBeenCalled();
    expect(mockInvalidateAuthorizationState).not.toHaveBeenCalled();
  });

  it('does not invalidate access state when persistence fails', async () => {
    mockCallFunction.mockRejectedValueOnce(new Error('database unavailable'));

    const response = await POST(request(CONSENT_BODY));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      error: 'Could not save consent',
    });
    expect(mockInvalidateAuthorizationState).not.toHaveBeenCalled();
  });

  it('records consent atomically and invalidates the cached access decision afterwards', async () => {
    const response = await POST(request(CONSENT_BODY));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true });
    expect(mockCallFunction).toHaveBeenCalledTimes(1);
    expect(mockCallFunction).toHaveBeenCalledWith('accept_terms_and_verify_age', ['user-1']);
    // Invalidation happens exactly once, strictly after the consent RPC lands —
    // never before persistence and never speculatively on failure paths.
    expect(mockInvalidateAuthorizationState).toHaveBeenCalledTimes(1);
    expect(mockInvalidateAuthorizationState).toHaveBeenCalledWith('user-1');
    expect(mockInvalidateAuthorizationState.mock.invocationCallOrder[0]).toBeGreaterThan(
      mockCallFunction.mock.invocationCallOrder[0]
    );
  });
});
