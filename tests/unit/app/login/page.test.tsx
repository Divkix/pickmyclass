import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import LoginPage from '@/app/login/page';
import { AuthProvider } from '@/lib/contexts/AuthContext';

// Mock the supabase client module
const mockSignInWithOAuth = vi.fn();
const mockSupabaseClient = {
  auth: {
    signInWithOAuth: mockSignInWithOAuth,
    getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }),
    getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
    onAuthStateChange: vi.fn().mockReturnValue({
      data: { subscription: { unsubscribe: vi.fn() } },
    }),
  },
};

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => mockSupabaseClient,
}));

// Mock next/navigation
const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
  useSearchParams: () => new URLSearchParams(),
}));

describe('LoginPage - Google OAuth loading state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSignInWithOAuth.mockReset();
  });

  it('should keep loading state true after successful OAuth initiation', async () => {
    // Mock successful OAuth initiation
    mockSignInWithOAuth.mockResolvedValue({ error: null });

    render(
      <AuthProvider>
        <LoginPage />
      </AuthProvider>
    );

    // Find the Google sign-in button
    const googleButton = screen.getByRole('button', { name: /sign in with google/i });

    // Click the button
    fireEvent.click(googleButton);

    // Wait for loading state to be set
    await waitFor(() => {
      expect(mockSignInWithOAuth).toHaveBeenCalled();
    });

    // The button should still be in loading state because
    // successful OAuth doesn't reset loading (browser will navigate away)
    expect(googleButton).toHaveTextContent(/redirecting to google/i);
  });

  it('should reset loading state on OAuth error', async () => {
    // Mock OAuth error
    mockSignInWithOAuth.mockResolvedValue({ error: { message: 'OAuth failed' } });

    render(
      <AuthProvider>
        <LoginPage />
      </AuthProvider>
    );

    const googleButton = screen.getByRole('button', { name: /sign in with google/i });

    fireEvent.click(googleButton);

    // Wait for error to be shown
    await waitFor(() => {
      expect(screen.getByText(/oauth failed/i)).toBeInTheDocument();
    });

    // Button should be back to normal state
    expect(googleButton).toHaveTextContent(/sign in with google/i);
  });
});
