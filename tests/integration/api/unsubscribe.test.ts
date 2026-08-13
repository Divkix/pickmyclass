import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import { GET, POST } from '@/app/api/unsubscribe/route';

const { mockEq, mockUpdate, mockVerifyUnsubscribeToken } = vi.hoisted(() => ({
  mockEq: vi.fn(),
  mockUpdate: vi.fn(),
  mockVerifyUnsubscribeToken: vi.fn(),
}));

vi.mock('@/lib/email/unsubscribe-token', () => ({
  verifyUnsubscribeToken: mockVerifyUnsubscribeToken,
}));

vi.mock('@/lib/supabase/service', () => ({
  getServiceClient: vi.fn(() => ({
    from: vi.fn(() => ({
      update: mockUpdate,
    })),
  })),
}));

function request(url: string, method = 'GET'): NextRequest {
  return new NextRequest(url, { method });
}

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

async function json(response: Response) {
  // SAFETY: test helper parses JSON response; shape asserted per test case via property access
  return response.json() as Promise<Record<string, JsonValue>>;
}
describe('/api/unsubscribe', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    mockVerifyUnsubscribeToken.mockReturnValue('user-123');
    mockUpdate.mockReturnValue({ eq: mockEq });
    mockEq.mockResolvedValue({ error: null });
  });

  afterEach(() => {
    errorSpy.mockRestore();
    logSpy.mockRestore();
  });

  it('rejects missing GET tokens with an HTML error page', async () => {
    const response = await GET(request('https://pickmyclass.app/api/unsubscribe'));
    const body = await response.text();

    expect(response.status).toBe(400);
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(body).toContain('Invalid Unsubscribe Link');
    expect(mockVerifyUnsubscribeToken).not.toHaveBeenCalled();
  });

  it('rejects invalid GET tokens before touching the database', async () => {
    mockVerifyUnsubscribeToken.mockReturnValue(null);

    const response = await GET(request('https://pickmyclass.app/api/unsubscribe?token=bad'));
    const body = await response.text();

    expect(response.status).toBe(400);
    expect(body).toContain('Invalid or Expired Token');
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('unsubscribes valid GET requests and returns the success page', async () => {
    const response = await GET(request('https://pickmyclass.app/api/unsubscribe?token=good'));
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain('Unsubscribed Successfully');
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        notifications_enabled: false,
        unsubscribed_at: expect.any(String),
      })
    );
    expect(mockEq).toHaveBeenCalledWith('user_id', 'user-123');
  });

  it('returns an HTML error page when GET unsubscribe persistence fails', async () => {
    mockEq.mockResolvedValueOnce({ error: { message: 'database down' } });

    const response = await GET(request('https://pickmyclass.app/api/unsubscribe?token=good'));
    const body = await response.text();

    expect(response.status).toBe(500);
    expect(body).toContain('Error Processing Unsubscribe');
  });

  it('validates one-click POST requests', async () => {
    const response = await POST(request('https://pickmyclass.app/api/unsubscribe', 'POST'));
    const data = await json(response);

    expect(response.status).toBe(400);
    expect(data.error).toBe('Invalid input');
    expect(mockVerifyUnsubscribeToken).not.toHaveBeenCalled();
  });

  it('rejects invalid one-click POST tokens', async () => {
    mockVerifyUnsubscribeToken.mockReturnValue(null);

    const response = await POST(
      request('https://pickmyclass.app/api/unsubscribe?token=bad', 'POST')
    );
    const data = await json(response);

    expect(response.status).toBe(400);
    expect(data.error).toBe('Invalid or expired token');
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('unsubscribes valid one-click POST requests', async () => {
    const response = await POST(
      request('https://pickmyclass.app/api/unsubscribe?token=good', 'POST')
    );
    const data = await json(response);

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(mockEq).toHaveBeenCalledWith('user_id', 'user-123');
  });

  it('returns JSON errors when one-click POST persistence fails', async () => {
    mockEq.mockResolvedValueOnce({ error: { message: 'database down' } });

    const response = await POST(
      request('https://pickmyclass.app/api/unsubscribe?token=good', 'POST')
    );
    const data = await json(response);

    expect(response.status).toBe(500);
    expect(data).toEqual({ success: false, error: 'Internal server error' });
  });
});
