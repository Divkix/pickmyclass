import { createClerkClient } from '@clerk/backend';
import { env } from 'cloudflare:workers';
import { describe, expect, it, vi } from 'vite-plus/test';

vi.mock('@clerk/backend', () => ({
  createClerkClient: vi.fn((options: { jwtKey?: string }) => ({ options })),
}));

import { getClerkClient } from '@/lib/auth/clerk-session';

const lastJwtKey = () => vi.mocked(createClerkClient).mock.calls.at(-1)?.[0].jwtKey;

describe('getClerkClient', () => {
  it('reuses the client while both keys are unchanged and evicts when the PEM is removed', () => {
    env.CLERK_SECRET_KEY = 'sk_test_evict';
    env.CLERK_JWT_KEY = '-----BEGIN PUBLIC KEY-----\nPEM-A';
    const first = getClerkClient();
    expect(getClerkClient()).toBe(first);

    delete env.CLERK_JWT_KEY;
    const second = getClerkClient();

    expect(second).not.toBe(first);
    expect(lastJwtKey()).toBeUndefined();
    expect(getClerkClient()).toBe(second);
  });

  it('evicts the client when the PEM rotates', () => {
    env.CLERK_SECRET_KEY = 'sk_test_rotate';
    env.CLERK_JWT_KEY = 'PEM-1';
    const first = getClerkClient();

    env.CLERK_JWT_KEY = 'PEM-2';
    const second = getClerkClient();

    expect(second).not.toBe(first);
    expect(lastJwtKey()).toBe('PEM-2');
  });

  it('evicts the client when the secret key changes', () => {
    env.CLERK_SECRET_KEY = 'sk_test_first';
    delete env.CLERK_JWT_KEY;
    const first = getClerkClient();

    env.CLERK_SECRET_KEY = 'sk_test_second';
    const second = getClerkClient();

    expect(second).not.toBe(first);
    expect(lastJwtKey()).toBeUndefined();
  });
});
