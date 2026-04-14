import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockVerify = vi.hoisted(() => vi.fn());
const mockAuthMaybeSingle = vi.hoisted(() => vi.fn());
const mockProfileUpdate = vi.hoisted(() => vi.fn());
const mockProfileEq = vi.hoisted(() => vi.fn());
const mockRpc = vi.hoisted(() => vi.fn());

vi.mock('resend', () => ({
  Resend: class {
    webhooks = {
      verify: mockVerify,
    };
  },
}));

vi.mock('@/lib/supabase/service', () => ({
  getServiceClient: vi.fn(() => ({
    schema: vi.fn(() => ({
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: mockAuthMaybeSingle,
          })),
        })),
      })),
    })),
    from: vi.fn((table: string) => {
      if (table === 'user_profiles') {
        return {
          update: mockProfileUpdate,
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    }),
    rpc: mockRpc,
  })),
}));

import { POST } from '@/app/api/webhooks/resend/route';

function createRequest(body: string, headers?: Record<string, string>): NextRequest {
  return new NextRequest('http://localhost:3000/api/webhooks/resend', {
    method: 'POST',
    body,
    headers: {
      'Content-Type': 'application/json',
      'svix-id': 'msg_123',
      'svix-timestamp': '1700000000',
      'svix-signature': 'v1,test',
      ...headers,
    },
  });
}

describe('POST /api/webhooks/resend', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.RESEND_WEBHOOK_SECRET = 'whsec_test_secret';
    process.env.RESEND_API_KEY = 're_test_api_key';

    mockProfileEq.mockResolvedValue({ error: null });
    mockProfileUpdate.mockReturnValue({
      eq: mockProfileEq,
    });
    mockAuthMaybeSingle.mockResolvedValue({ data: { id: 'user-123' }, error: null });
    mockRpc.mockResolvedValue({ error: null });
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('should return 401 when Svix signature verification fails', async () => {
    mockVerify.mockImplementation(() => {
      throw new Error('invalid signature');
    });

    const request = createRequest(
      JSON.stringify({
        type: 'email.delivered',
        data: { to: ['test@example.com'], email_id: 'email_1' },
      })
    );
    const response = await POST(request);
    const data = (await response.json()) as { success: boolean; error: string };

    expect(response.status).toBe(401);
    expect(data.success).toBe(false);
    expect(data.error).toBe('Invalid signature');
  });

  it('should process hard bounces from modern payload shape', async () => {
    mockVerify.mockReturnValue({
      type: 'email.bounced',
      data: {
        to: ['Bounced@Example.com'],
        bounce: {
          type: 'Permanent',
          subType: 'Suppressed',
          message: 'Hard bounce',
        },
      },
    });

    const request = createRequest(
      JSON.stringify({
        type: 'email.bounced',
      })
    );
    const response = await POST(request);
    const data = (await response.json()) as { success: boolean };

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(mockProfileUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        email_bounced: true,
        notifications_enabled: false,
      })
    );
    expect(mockProfileEq).toHaveBeenCalledWith('user_id', 'user-123');
  });

  it('should ignore soft/transient bounces', async () => {
    mockVerify.mockReturnValue({
      type: 'email.bounced',
      data: {
        to: ['soft@example.com'],
        bounce: {
          type: 'Transient',
          message: 'Soft bounce',
        },
      },
    });

    const request = createRequest(
      JSON.stringify({
        type: 'email.bounced',
      })
    );
    const response = await POST(request);
    const data = (await response.json()) as { success: boolean };

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(mockProfileUpdate).not.toHaveBeenCalled();
  });

  it('should safely ignore events without recipients', async () => {
    mockVerify.mockReturnValue({
      type: 'email.complained',
      data: {
        to: [],
      },
    });

    const request = createRequest(
      JSON.stringify({
        type: 'email.complained',
      })
    );
    const response = await POST(request);
    const data = (await response.json()) as { success: boolean };

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(mockProfileUpdate).not.toHaveBeenCalled();
  });
});
