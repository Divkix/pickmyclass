import { NextRequest } from 'next/server';
import { Webhook } from 'standardwebhooks';
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test';

const mockEmailSend = vi.hoisted(() => vi.fn());

vi.mock('cloudflare:workers', () => ({
  env: {
    EMAIL: {
      send: mockEmailSend,
    },
    NOTIFICATION_FROM_EMAIL: 'notifications@pickmyclass.app',
    SUPABASE_SEND_EMAIL_HOOK_SECRET: 'whsec_dGVzdC1zZWNyZXQ=',
  },
}));

import { POST } from '@/app/api/auth/send-email-hook/route';

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

function signedRequest(
  payload: Record<string, JsonValue>,
  secret = 'whsec_dGVzdC1zZWNyZXQ='
): NextRequest {
  const body = JSON.stringify(payload);
  const webhook = new Webhook(secret);
  const id = 'msg_test_123';
  const timestamp = new Date();

  return new NextRequest('http://localhost:3000/api/auth/send-email-hook', {
    method: 'POST',
    body,
    headers: {
      'content-type': 'application/json',
      'webhook-id': id,
      'webhook-timestamp': `${Math.floor(timestamp.getTime() / 1000)}`,
      'webhook-signature': webhook.sign(id, timestamp, body),
    },
  });
}

const payload = {
  user: {
    id: 'user-123',
    email: 'student@example.com',
  },
  email_data: {
    token: '123456',
    token_hash: 'hash_abc',
    redirect_to: 'https://pickmyclass.app/auth/callback?next=/dashboard',
    email_action_type: 'signup',
    site_url: 'https://pickmyclass.app',
    token_new: '',
    token_hash_new: '',
    old_email: '',
    old_phone: '',
    provider: '',
    factor_type: '',
  },
};

describe('POST /api/auth/send-email-hook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEmailSend.mockResolvedValue({ messageId: 'msg_cf_123' });
  });

  it('rejects requests with invalid webhook signatures', async () => {
    const response = await POST(signedRequest(payload, 'whsec_d3Jvbmctc2VjcmV0'));

    expect(response.status).toBe(401);
    expect(mockEmailSend).not.toHaveBeenCalled();
  });

  it('sends verified Supabase auth emails through Cloudflare Email Sending', async () => {
    const response = await POST(signedRequest(payload));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({});
    expect(mockEmailSend).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'student@example.com',
        from: 'notifications@pickmyclass.app',
        subject: 'Verify your PickMyClass email',
        html: expect.stringContaining('hash_abc'),
        text: expect.stringContaining('https://osopxwuebsefhoxgeojh.supabase.co/auth/v1/verify'),
      })
    );
  });

  it('accepts Supabase hook secrets copied with the v1 prefix', async () => {
    vi.resetModules();
    vi.doMock('cloudflare:workers', () => ({
      env: {
        EMAIL: {
          send: mockEmailSend,
        },
        NOTIFICATION_FROM_EMAIL: 'notifications@pickmyclass.app',
        SUPABASE_SEND_EMAIL_HOOK_SECRET: 'v1,whsec_dGVzdC1zZWNyZXQ=',
      },
    }));

    const { POST: prefixedSecretPost } = await import('@/app/api/auth/send-email-hook/route');

    const response = await prefixedSecretPost(signedRequest(payload));

    expect(response.status).toBe(200);
    expect(mockEmailSend).toHaveBeenCalled();
  });

  it('returns 502 when Cloudflare Email Sending fails', async () => {
    mockEmailSend.mockRejectedValueOnce(new Error('send failed'));

    const response = await POST(signedRequest(payload));

    expect(response.status).toBe(502);
  });
});
