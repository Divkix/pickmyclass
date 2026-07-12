import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test';

const { mockCreateClient, mockGetUser, mockInvalidateAuthorizationState, mockRpc } = vi.hoisted(
  () => ({
    mockCreateClient: vi.fn(),
    mockGetUser: vi.fn(),
    mockInvalidateAuthorizationState: vi.fn(),
    mockRpc: vi.fn(),
  })
);

vi.mock('@/lib/auth/authorization-state', () => ({
  invalidateAuthorizationState: mockInvalidateAuthorizationState,
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: mockCreateClient,
}));

import { POST } from '@/app/api/auth/consent/route';

function request(body: unknown): NextRequest {
  return new NextRequest('https://pickmyclass.app/api/auth/consent', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

describe('POST /api/auth/consent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });
    mockRpc.mockResolvedValue({ error: null });
    mockCreateClient.mockResolvedValue({
      auth: { getUser: mockGetUser },
      rpc: mockRpc,
    });
  });

  it('rejects requests that do not explicitly confirm both statements', async () => {
    const response = await POST(request({ ageVerified: true, agreedToTerms: false }));

    expect(response.status).toBe(400);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('requires an authenticated user', async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null }, error: null });

    const response = await POST(request({ ageVerified: true, agreedToTerms: true }));

    expect(response.status).toBe(401);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('records consent atomically and invalidates the cached access decision', async () => {
    const response = await POST(request({ ageVerified: true, agreedToTerms: true }));

    expect(response.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith('accept_terms_and_verify_age');
    expect(mockInvalidateAuthorizationState).toHaveBeenCalledWith('user-1');
  });

  it('does not invalidate access state when persistence fails', async () => {
    mockRpc.mockResolvedValueOnce({ error: { message: 'database unavailable' } });

    const response = await POST(request({ ageVerified: true, agreedToTerms: true }));

    expect(response.status).toBe(500);
    expect(mockInvalidateAuthorizationState).not.toHaveBeenCalled();
  });
});
