import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test';

const { mockCreateClient, mockGetUser, mockCallFunction, mockInvalidateAuthorizationState } =
  vi.hoisted(() => ({
    mockCreateClient: vi.fn(),
    mockGetUser: vi.fn(),
    mockCallFunction: vi.fn(),
    mockInvalidateAuthorizationState: vi.fn(),
  }));

vi.mock('@/lib/auth/authorization-state', () => ({
  invalidateAuthorizationState: mockInvalidateAuthorizationState,
}));

// Auth stays on Supabase (supabase.auth.getUser) — keep the server client mock.
vi.mock('@/lib/supabase/server', () => ({
  createClient: mockCreateClient,
}));

// Data plane now goes through lib/db/client (callFunction replaces .rpc()).
vi.mock('@/lib/db/client', () => ({
  callFunction: mockCallFunction,
  query: vi.fn(),
  queryOne: vi.fn(),
  queryScalar: vi.fn(),
  execute: vi.fn(),
  callFunctionScalar: vi.fn(),
  getClient: vi.fn(),
  setConnectionStringGetter: vi.fn(),
}));

import { POST } from '@/app/api/auth/consent/route';

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

function request(body: Record<string, JsonValue>): NextRequest {
  return new NextRequest('https://pickmyclass.app/api/auth/consent', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}
describe.skip('POST /api/auth/consent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });
    mockCallFunction.mockResolvedValue([]);
    mockCreateClient.mockResolvedValue({
      auth: { getUser: mockGetUser },
    });
  });

  it('rejects requests that do not explicitly confirm both statements', async () => {
    const response = await POST(request({ ageVerified: true, agreedToTerms: false }));

    expect(response.status).toBe(400);
    expect(mockCallFunction).not.toHaveBeenCalled();
  });

  it('requires an authenticated user', async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null }, error: null });

    const response = await POST(request({ ageVerified: true, agreedToTerms: true }));

    expect(response.status).toBe(401);
    expect(mockCallFunction).not.toHaveBeenCalled();
  });

  it('records consent atomically and invalidates the cached access decision', async () => {
    const response = await POST(request({ ageVerified: true, agreedToTerms: true }));

    expect(response.status).toBe(200);
    expect(mockCallFunction).toHaveBeenCalledWith('accept_terms_and_verify_age', ['user-1']);
    expect(mockInvalidateAuthorizationState).toHaveBeenCalledWith('user-1');
  });

  it('does not invalidate access state when persistence fails', async () => {
    mockCallFunction.mockRejectedValueOnce(new Error('database unavailable'));

    const response = await POST(request({ ageVerified: true, agreedToTerms: true }));

    expect(response.status).toBe(500);
    expect(mockInvalidateAuthorizationState).not.toHaveBeenCalled();
  });
});
