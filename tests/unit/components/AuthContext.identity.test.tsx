import { act, render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import { AuthProvider, useAuth } from '@/lib/contexts/AuthContext';

const { mockIdentify, mockReset, clerkUser } = vi.hoisted(() => ({
  mockIdentify: vi.fn(),
  mockReset: vi.fn(),
  clerkUser: {
    // SAFETY: starts signed-out; every assignment below passes satisfies ClerkUserFixture.
    current: null as ClerkUserFixture | null,
  },
}));

vi.mock('@/lib/analytics/client', () => ({
  identifyAnalyticsUser: mockIdentify,
  resetAnalyticsIdentity: mockReset,
  trackAnalyticsEvent: vi.fn(),
}));

vi.mock('@clerk/react', () => ({
  useUser: () => ({
    isLoaded: true,
    isSignedIn: clerkUser.current !== null,
    user: clerkUser.current,
  }),
  useAuth: () => ({ isLoaded: true, isSignedIn: true, sessionId: 'sess_test' }),
  useClerk: () => ({
    signOut: vi.fn(async () => {
      clerkUser.current = null;
    }),
  }),
}));

interface ClerkUserFixture {
  id: string;
  externalId?: string | null;
  primaryEmailAddress?: {
    emailAddress: string;
    verification: { status: string };
  } | null;
  createdAt: Date;
  lastSignInAt: Date | null;
}

describe('analytics identity rule', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('prefers the Clerk externalId (migrated Supabase UUID) as the analytics identity', async () => {
    clerkUser.current = {
      id: 'user_clerk_123',
      externalId: 'legacy-supabase-uuid',
      primaryEmailAddress: {
        emailAddress: 'student@example.com',
        verification: { status: 'verified' },
      },
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      lastSignInAt: null,
    } satisfies ClerkUserFixture;

    render(<AuthProvider>{null}</AuthProvider>);

    await waitFor(() => expect(mockIdentify).toHaveBeenCalled());
    expect(mockIdentify).toHaveBeenCalledWith('legacy-supabase-uuid', {
      email: 'student@example.com',
    });
  });

  it('falls back to the Clerk id when no externalId exists (post-cutover users)', async () => {
    clerkUser.current = {
      id: 'user_clerk_456',
      externalId: null,
      primaryEmailAddress: {
        emailAddress: 'newstudent@example.com',
        verification: { status: 'verified' },
      },
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      lastSignInAt: null,
    } satisfies ClerkUserFixture;

    render(<AuthProvider>{null}</AuthProvider>);

    await waitFor(() => expect(mockIdentify).toHaveBeenCalled());
    expect(mockIdentify).toHaveBeenCalledWith('user_clerk_456', {
      email: 'newstudent@example.com',
    });
  });

  it('resets identity when the session ends outside signOut (expiry, other tab)', async () => {
    clerkUser.current = {
      id: 'user_clerk_789',
      externalId: null,
      primaryEmailAddress: null,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      lastSignInAt: null,
    } satisfies ClerkUserFixture;

    const { rerender } = render(<AuthProvider>{null}</AuthProvider>);

    await waitFor(() => expect(mockIdentify).toHaveBeenCalled());
    expect(mockReset).not.toHaveBeenCalled();

    clerkUser.current = null;
    rerender(<AuthProvider>{null}</AuthProvider>);

    await waitFor(() => expect(mockReset).toHaveBeenCalledTimes(1));
  });

  it('never resets an anonymous visitor who was not signed in', async () => {
    clerkUser.current = null;

    render(<AuthProvider>{null}</AuthProvider>);

    await waitFor(() => expect(mockIdentify).not.toHaveBeenCalled());
    expect(mockReset).not.toHaveBeenCalled();
  });

  it('resets exactly once when the user signs out through signOut()', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null)));
    clerkUser.current = {
      id: 'user_clerk_321',
      externalId: null,
      primaryEmailAddress: null,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      lastSignInAt: null,
    } satisfies ClerkUserFixture;

    let signOut: (() => Promise<void>) | undefined;

    function SignOutProbe() {
      signOut = useAuth().signOut;

      return null;
    }

    const { rerender } = render(
      <AuthProvider>
        <SignOutProbe />
      </AuthProvider>
    );

    await waitFor(() => expect(mockIdentify).toHaveBeenCalled());
    await act(async () => {
      await signOut?.();
    });
    rerender(
      <AuthProvider>
        <SignOutProbe />
      </AuthProvider>
    );

    await waitFor(() => expect(mockReset).toHaveBeenCalledTimes(1));
    vi.unstubAllGlobals();
  });
});
