import { type SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test';

const {
  dbHandle,
  mockExecute,
  mockRequireUser,
  mockRepairUserMirror,
  mockInvalidateAuthorizationState,
} = vi.hoisted(() => {
  const mockExecute = vi.fn();
  return {
    // Recording Database handle handed out by the mocked getDbFromEnv; every
    // POST must create exactly one request-scoped handle through it.
    dbHandle: { execute: mockExecute },
    mockExecute,
    mockRequireUser: vi.fn(),
    mockRepairUserMirror: vi.fn(),
    mockInvalidateAuthorizationState: vi.fn(),
  };
});

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

// Request-scoped handle seam: the route calls getDbFromEnv() once per POST.
vi.mock('@/lib/db', () => ({
  getDbFromEnv: () => dbHandle,
}));

vi.mock('@/lib/auth/authorization-state', () => ({
  invalidateAuthorizationState: mockInvalidateAuthorizationState,
}));

// Import after mocks are registered
import { POST } from '@/app/api/auth/consent/route';
import { UnauthorizedError } from '@/lib/auth/require-user';

const dialect = new PgDialect();

/** Normalize a built SQL template to comparable single-spaced text. */
function builtSql(query: SQL): string {
  return dialect.sqlToQuery(query).sql.replace(/\s+/g, ' ').trim();
}

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
    mockExecute.mockResolvedValue([]);
  });

  it('rejects requests that do not explicitly confirm both statements', async () => {
    const response = await POST(request({ ageVerified: true, agreedToTerms: false }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      error: 'Invalid input',
    });
    expect(mockExecute).not.toHaveBeenCalled();
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
    expect(mockExecute).not.toHaveBeenCalled();
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
    expect(mockRepairUserMirror).toHaveBeenCalledWith(dbHandle, 'user-1', 'clerk-1');
    expect(mockExecute).not.toHaveBeenCalled();
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
    expect(mockExecute).not.toHaveBeenCalled();
    expect(mockInvalidateAuthorizationState).not.toHaveBeenCalled();
  });

  it('does not invalidate access state when persistence fails', async () => {
    mockExecute.mockRejectedValueOnce(new Error('database unavailable'));

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
    // Exactly one handle is created for repair + RPC, and the RPC runs with a
    // bound, explicitly cast user id.
    expect(mockExecute).toHaveBeenCalledTimes(1);
    const query = mockExecute.mock.calls[0][0] as SQL;
    expect(builtSql(query)).toBe('SELECT public.accept_terms_and_verify_age($1::text)');
    expect(dialect.sqlToQuery(query).params).toEqual(['user-1']);
    // Invalidation happens exactly once, strictly after the consent RPC lands —
    // never before persistence and never speculatively on failure paths.
    expect(mockInvalidateAuthorizationState).toHaveBeenCalledTimes(1);
    expect(mockInvalidateAuthorizationState).toHaveBeenCalledWith('user-1');
    expect(mockInvalidateAuthorizationState.mock.invocationCallOrder[0]).toBeGreaterThan(
      mockExecute.mock.invocationCallOrder[0]
    );
  });
});
