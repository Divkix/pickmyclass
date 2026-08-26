import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type * as AuthContextModule from '@/lib/contexts/AuthContext';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vite-plus/test';
import { AuthButton } from '@/components/AuthButton';
import { AuthProvider } from '@/lib/contexts/AuthContext';

const h = vi.hoisted(() => ({
  track: vi.fn(),
  reset: vi.fn(),
  identify: vi.fn(),
  clerkSignOut: vi.fn(),
  contextSignOut: vi.fn(),
  // When true, useAuth resolves through the real AuthProvider; when false,
  // tests supply a canned context value (e.g. a rejecting signOut).
  useRealProvider: true,
}));

vi.mock('@/lib/analytics/client', () => ({
  trackAnalyticsEvent: h.track,
  resetAnalyticsIdentity: h.reset,
  identifyAnalyticsUser: h.identify,
}));

vi.mock('@clerk/react', () => ({
  useUser: () => ({
    isLoaded: true,
    isSignedIn: true,
    user: {
      id: 'user-1',
      primaryEmailAddress: {
        emailAddress: 'student@example.com',
        verification: { status: 'verified' },
      },
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      lastSignInAt: null,
    },
  }),
  useAuth: () => ({ isLoaded: true, isSignedIn: true, sessionId: 'sess_test' }),
  useClerk: () => ({ signOut: h.clerkSignOut }),
}));

vi.mock('@/lib/contexts/AuthContext', async (importOriginal) => {
  const actual = await importOriginal<typeof AuthContextModule>();
  return {
    ...actual,
    useAuth: () =>
      h.useRealProvider
        ? actual.useAuth()
        : {
            user: { id: 'user-1', email: 'student@example.com', email_confirmed_at: null },
            session: { id: 'sess_test' },
            loading: false,
            signOut: h.contextSignOut,
          },
  };
});

const originalLocation = window.location;

beforeAll(() => {
  Object.defineProperty(window, 'location', {
    configurable: true,
    writable: true,
    value: { href: '' },
  });
});

afterAll(() => {
  Object.defineProperty(window, 'location', {
    configurable: true,
    writable: true,
    value: originalLocation,
  });
});

describe('AuthButton', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    h.useRealProvider = true;
    window.location.href = '';
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('signs out through the full seam: tracks, resets analytics, signs out of Clerk, then POSTs once', async () => {
    const order: string[] = [];
    h.track.mockImplementation(() => {
      order.push('track');
    });
    h.reset.mockImplementation(() => {
      order.push('reset');
    });
    h.clerkSignOut.mockImplementation(async () => {
      order.push('clerk-sign-out');
    });
    fetchMock.mockImplementation(async (_input: RequestInfo, init?: RequestInit) => {
      if (init?.method === 'POST') {
        order.push('server-revoke-post');
      }
      return { ok: true, status: 200, json: async () => ({}) };
    });

    render(
      <AuthProvider>
        <AuthButton />
      </AuthProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: /sign out/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/auth/signout', { method: 'POST' });
    });

    expect(h.track).toHaveBeenCalledTimes(1);
    expect(h.track).toHaveBeenCalledWith('user_logged_out', {});
    expect(h.reset).toHaveBeenCalledTimes(1);
    expect(h.clerkSignOut).toHaveBeenCalledTimes(1);

    expect(fetchMock).toHaveBeenCalledTimes(1);

    expect(order).toEqual(['track', 'reset', 'clerk-sign-out', 'server-revoke-post']);
  });

  it('falls back to navigating to /sign-in when signOut rejects', async () => {
    h.useRealProvider = false;
    h.contextSignOut.mockRejectedValue(new Error('sign-out failed'));

    render(<AuthButton />);

    fireEvent.click(screen.getByRole('button', { name: /sign out/i }));

    await waitFor(() => {
      expect(window.location.href).toBe('/sign-in');
    });
  });
});
