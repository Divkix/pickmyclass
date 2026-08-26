import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import { AuthProvider } from '@/lib/contexts/AuthContext';

const { mockIdentify, clerkUser } = vi.hoisted(() => ({
  mockIdentify: vi.fn(),
  // Mutable Clerk user fixture; each test installs its own externalId shape.
  clerkUser: { current: null as unknown },
}));

vi.mock('@/lib/analytics/client', () => ({
  identifyAnalyticsUser: mockIdentify,
  resetAnalyticsIdentity: vi.fn(),
  trackAnalyticsEvent: vi.fn(),
}));

// Clerk seam override: setup.ts provides a global signed-out mock; these tests
// need full control over the Clerk user's externalId.
vi.mock('@clerk/react', () => ({
  useUser: () => ({ isLoaded: true, isSignedIn: true, user: clerkUser.current }),
  useAuth: () => ({ isLoaded: true, isSignedIn: true, sessionId: 'sess_test' }),
  useClerk: () => ({ signOut: vi.fn().mockResolvedValue(undefined) }),
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
});
