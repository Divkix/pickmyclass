import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeAll, vi } from 'vite-plus/test';

// Cleanup after each test
afterEach(() => {
  cleanup();
});

// Mock window.matchMedia for animations
beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });

  // Mock ResizeObserver
  global.ResizeObserver = vi.fn().mockImplementation(() => ({
    observe: vi.fn(),
    unobserve: vi.fn(),
    disconnect: vi.fn(),
  }));

  // Mock IntersectionObserver
  global.IntersectionObserver = vi.fn().mockImplementation(() => ({
    observe: vi.fn(),
    unobserve: vi.fn(),
    disconnect: vi.fn(),
  }));
});

// Mock environment variables for tests
vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-secret-key');
vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://test.example.com');
vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://test.supabase.co');
vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'test-anon-key');
vi.stubEnv('CLERK_SECRET_KEY', 'sk_test_dummy');
vi.stubEnv('CLERK_PUBLISHABLE_KEY', 'pk_test_dummy');
vi.stubEnv('CLERK_JWT_KEY', 'test-jwt-key');
vi.stubEnv('CLERK_WEBHOOK_SIGNING_SECRET', 'whsec_test');

// Global Clerk mock — pages that use useSignIn/useUser/useClerk need a provider.
// Individual tests can override with vi.mocked(useSignIn).mockReturnValue etc.
vi.mock('@clerk/clerk-react', () => ({
  ClerkProvider: ({ children }: { children: React.ReactNode }) => children,
  useSignIn: () => ({
    isLoaded: true,
    signIn: {
      create: vi.fn().mockResolvedValue({ status: 'complete', createdSessionId: 'sess_test' }),
      authenticateWithRedirect: vi.fn().mockResolvedValue(undefined),
      attemptFirstFactor: vi
        .fn()
        .mockResolvedValue({ status: 'complete', createdSessionId: 'sess_test' }),
    },
    setActive: vi.fn().mockResolvedValue(undefined),
  }),
  useSignUp: () => ({
    isLoaded: true,
    signUp: { create: vi.fn() },
  }),
  useUser: () => ({
    isLoaded: true,
    isSignedIn: false,
    user: null,
  }),
  useClerk: () => ({
    signOut: vi.fn().mockResolvedValue(undefined),
  }),
  useAuth: () => ({
    isLoaded: true,
    isSignedIn: false,
    sessionId: null,
    userId: null,
  }),
  useSession: () => ({ isLoaded: true, session: null }),
  AuthenticateWithRedirectCallback: () => null,
  SignInButton: ({ children }: { children: React.ReactNode }) => children,
  SignUpButton: ({ children }: { children: React.ReactNode }) => children,
  SignedIn: ({ children }: { children: React.ReactNode }) => children,
  SignedOut: ({ children }: { children: React.ReactNode }) => children,
}));
