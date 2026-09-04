import type { SessionWebhookEvent, UserDeletedJSON, UserJSON, WebhookEvent } from '@clerk/backend';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';

const {
  webhookEnv,
  dbHandle,
  mockGetDbFromEnv,
  mockSoftDeleteUserById,
  mockSyncUserMirrorFromClerkUser,
  mockVerifyWebhook,
} = vi.hoisted(() => {
  const webhookEnv: { CLERK_WEBHOOK_SIGNING_SECRET?: string } = {
    CLERK_WEBHOOK_SIGNING_SECRET: 'whsec_test_binding',
  };
  const dbHandle = {};
  const mockGetDbFromEnv = vi.fn(() => dbHandle);
  return {
    webhookEnv,
    dbHandle,
    mockGetDbFromEnv,
    mockSoftDeleteUserById: vi.fn(),
    mockSyncUserMirrorFromClerkUser: vi.fn(),
    mockVerifyWebhook: vi.fn(),
  };
});

vi.mock('@clerk/backend/webhooks', () => ({
  verifyWebhook: mockVerifyWebhook,
}));

vi.mock('cloudflare:workers', () => ({ env: webhookEnv }));

vi.mock('@/lib/db/users', () => ({
  syncUserMirrorFromClerkUser: mockSyncUserMirrorFromClerkUser,
  softDeleteUserById: mockSoftDeleteUserById,
}));

vi.mock('@/lib/db', () => ({
  getDbFromEnv: mockGetDbFromEnv,
}));

import { POST } from '@/app/api/webhooks/clerk/route';

const WEBHOOK_SIGNING_SECRET = 'whsec_test_binding';
const CLERK_USER_ID = 'user_2webhookfixture';
const PRIMARY_EMAIL_ID = 'idn_email_primary';

type UserUpsertEvent = Extract<WebhookEvent, { type: 'user.created' | 'user.updated' }>;
type UserDeletedEvent = Extract<WebhookEvent, { type: 'user.deleted' }>;

const svixDelivery = {
  event_attributes: {
    http_request: { client_ip: '127.0.0.1', user_agent: 'Svix-Webhooks/1.16' },
  },
};

function clerkUserFixture(overrides: Partial<UserJSON> = {}): UserJSON {
  return {
    object: 'user',
    id: CLERK_USER_ID,
    username: null,
    first_name: 'Primary',
    last_name: 'User',
    image_url: 'https://img.clerk.example/u/2.png',
    has_image: false,
    primary_email_address_id: PRIMARY_EMAIL_ID,
    primary_phone_number_id: null,
    primary_web3_wallet_id: null,
    password_enabled: true,
    two_factor_enabled: false,
    totp_enabled: false,
    backup_code_enabled: false,
    email_addresses: [
      {
        object: 'email_address',
        id: PRIMARY_EMAIL_ID,
        email_address: 'Primary.User@Example.com',
        linked_to: [],
        verification: null,
      },
    ],
    phone_numbers: [],
    web3_wallets: [],
    organization_memberships: null,
    external_accounts: [],
    enterprise_accounts: [],
    password_last_updated_at: null,
    public_metadata: { age_verified: true, agreed_to_terms: true },
    private_metadata: {},
    unsafe_metadata: {},
    external_id: null,
    last_sign_in_at: 1_755_000_000_000,
    banned: false,
    locked: false,
    lockout_expires_in_seconds: null,
    verification_attempts_remaining: null,
    created_at: 1_754_000_000_000,
    updated_at: 1_755_000_000_000,
    last_active_at: 1_755_000_000_000,
    create_organization_enabled: false,
    create_organizations_limit: null,
    delete_self_enabled: true,
    legal_accepted_at: null,
    locale: null,
    ...overrides,
  };
}

function signedRequest(): NextRequest {
  return new NextRequest('https://pickmyclass.example/api/webhooks/clerk', {
    method: 'POST',
  });
}

type WebhookEnvelope = { success: true } | { success: false; error: string };

async function responseBody(response: Response): Promise<WebhookEnvelope> {
  return await response.json();
}

describe('POST /api/webhooks/clerk', () => {
  let errorSpy: { mockRestore: () => void };
  let warnSpy: { mockRestore: () => void };

  beforeEach(() => {
    vi.clearAllMocks();
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it('rejects unverifiable signatures with 400 before touching the mirror', async () => {
    const request = signedRequest();
    mockVerifyWebhook.mockRejectedValue(new Error('signature mismatch'));

    const response = await POST(request);
    const data = await responseBody(response);

    expect(response.status).toBe(400);
    expect(data).toEqual({ success: false, error: 'Invalid signature' });
    expect(mockVerifyWebhook).toHaveBeenCalledWith(request, {
      signingSecret: WEBHOOK_SIGNING_SECRET,
    });
    expect(mockGetDbFromEnv).not.toHaveBeenCalled();
    expect(mockSyncUserMirrorFromClerkUser).not.toHaveBeenCalled();
    expect(mockSoftDeleteUserById).not.toHaveBeenCalled();
  });

  it('delegates user.created payloads verbatim to the mirror sync and acknowledges', async () => {
    const user = clerkUserFixture();
    const event: UserUpsertEvent = {
      type: 'user.created',
      object: 'event',
      data: user,
      ...svixDelivery,
    };
    mockVerifyWebhook.mockResolvedValue(event);
    mockSyncUserMirrorFromClerkUser.mockResolvedValue(true);

    const response = await POST(signedRequest());
    const data = await responseBody(response);

    expect(response.status).toBe(200);
    expect(data).toEqual({ success: true });
    expect(mockGetDbFromEnv).toHaveBeenCalledTimes(1);
    expect(mockSyncUserMirrorFromClerkUser).toHaveBeenCalledTimes(1);
    expect(mockSyncUserMirrorFromClerkUser.mock.calls[0][0]).toBe(dbHandle);
    expect(mockSyncUserMirrorFromClerkUser.mock.calls[0][1]).toBe(user);
    expect(mockSoftDeleteUserById).not.toHaveBeenCalled();
  });

  it('routes user.updated through the same mirror sync seam', async () => {
    const user = clerkUserFixture({ id: 'user_2updated' });
    const event: UserUpsertEvent = {
      type: 'user.updated',
      object: 'event',
      data: user,
      ...svixDelivery,
    };
    mockVerifyWebhook.mockResolvedValue(event);

    const response = await POST(signedRequest());
    const data = await responseBody(response);

    expect(response.status).toBe(200);
    expect(data).toEqual({ success: true });
    expect(mockGetDbFromEnv).toHaveBeenCalledTimes(1);
    expect(mockSyncUserMirrorFromClerkUser).toHaveBeenCalledTimes(1);
    expect(mockSyncUserMirrorFromClerkUser.mock.calls[0][0]).toBe(dbHandle);
    expect(mockSyncUserMirrorFromClerkUser.mock.calls[0][1]).toBe(user);
    expect(mockSoftDeleteUserById).not.toHaveBeenCalled();
  });

  it('returns 500 so Svix redelivers when the mirror sync throws', async () => {
    const event: UserUpsertEvent = {
      type: 'user.created',
      object: 'event',
      data: clerkUserFixture(),
      ...svixDelivery,
    };
    mockVerifyWebhook.mockResolvedValue(event);
    mockSyncUserMirrorFromClerkUser.mockRejectedValue(new Error('users mirror connection reset'));

    const response = await POST(signedRequest());
    const data = await responseBody(response);

    expect(response.status).toBe(500);
    expect(data).toEqual({ success: false, error: 'Webhook processing failed' });
    expect(mockSoftDeleteUserById).not.toHaveBeenCalled();
  });

  it('acknowledges unrelated event types without touching the mirror seams', async () => {
    const event: SessionWebhookEvent = {
      type: 'session.created',
      object: 'event',
      data: {
        object: 'session',
        id: 'sess_webhookfixture',
        client_id: 'client_webhookfixture',
        user_id: CLERK_USER_ID,
        status: 'active',
        actor: null,
        last_active_at: 1_755_000_000_000,
        expire_at: 1_755_086_400_000,
        abandon_at: 1_755_172_800_000,
        created_at: 1_755_000_000_000,
        updated_at: 1_755_000_000_000,
        user: null,
      },
      ...svixDelivery,
    };
    mockVerifyWebhook.mockResolvedValue(event);

    const response = await POST(signedRequest());
    const data = await responseBody(response);

    expect(response.status).toBe(200);
    expect(data).toEqual({ success: true });
    expect(mockSyncUserMirrorFromClerkUser).not.toHaveBeenCalled();
    expect(mockSoftDeleteUserById).not.toHaveBeenCalled();
  });

  it('still acknowledges 200 when the sync reports there was no email to store', async () => {
    const user = clerkUserFixture({ email_addresses: [], primary_email_address_id: null });
    const event: UserUpsertEvent = {
      type: 'user.updated',
      object: 'event',
      data: user,
      ...svixDelivery,
    };
    mockVerifyWebhook.mockResolvedValue(event);
    mockSyncUserMirrorFromClerkUser.mockResolvedValue(false);

    const response = await POST(signedRequest());
    const data = await responseBody(response);

    expect(response.status).toBe(200);
    expect(data).toEqual({ success: true });
    expect(mockSyncUserMirrorFromClerkUser).toHaveBeenCalledTimes(1);
    expect(mockSyncUserMirrorFromClerkUser.mock.calls[0][0]).toBe(dbHandle);
    expect(mockSyncUserMirrorFromClerkUser.mock.calls[0][1]).toBe(user);
  });

  it('applies the soft delete to the profile on user.deleted', async () => {
    const event: UserDeletedEvent = {
      type: 'user.deleted',
      object: 'event',
      data: {
        object: 'user',
        id: CLERK_USER_ID,
        deleted: true,
      } satisfies UserDeletedJSON,
      ...svixDelivery,
    };
    mockVerifyWebhook.mockResolvedValue(event);
    mockSoftDeleteUserById.mockResolvedValue(1);

    const response = await POST(signedRequest());
    const data = await responseBody(response);

    expect(response.status).toBe(200);
    expect(data).toEqual({ success: true });
    expect(mockGetDbFromEnv).toHaveBeenCalledTimes(1);
    expect(mockSoftDeleteUserById).toHaveBeenCalledTimes(1);
    expect(mockSoftDeleteUserById).toHaveBeenCalledWith(dbHandle, CLERK_USER_ID);
    expect(mockSyncUserMirrorFromClerkUser).not.toHaveBeenCalled();
  });

  it('acknowledges user.deleted events without an id without deleting anything', async () => {
    const event: UserDeletedEvent = {
      type: 'user.deleted',
      object: 'event',
      data: { object: 'user', deleted: true },
      ...svixDelivery,
    };
    mockVerifyWebhook.mockResolvedValue(event);

    const response = await POST(signedRequest());
    const data = await responseBody(response);

    expect(response.status).toBe(200);
    expect(data).toEqual({ success: true });
    expect(mockSoftDeleteUserById).not.toHaveBeenCalled();
  });

  it('fails closed with 500 when the signing secret binding is missing', async () => {
    const previousSecret = webhookEnv.CLERK_WEBHOOK_SIGNING_SECRET;
    webhookEnv.CLERK_WEBHOOK_SIGNING_SECRET = undefined;

    try {
      const response = await POST(signedRequest());
      const data = await responseBody(response);

      expect(response.status).toBe(500);
      expect(data).toEqual({ success: false, error: 'Webhook not configured' });
      expect(mockVerifyWebhook).not.toHaveBeenCalled();
      expect(mockGetDbFromEnv).not.toHaveBeenCalled();
      expect(mockSyncUserMirrorFromClerkUser).not.toHaveBeenCalled();
      expect(mockSoftDeleteUserById).not.toHaveBeenCalled();
    } finally {
      webhookEnv.CLERK_WEBHOOK_SIGNING_SECRET = previousSecret;
    }
  });
});
