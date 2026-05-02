import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import RegisterPage from '@/app/register/page';
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

describe('RegisterPage - Google OAuth loading state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSignInWithOAuth.mockReset();
  });

  it('should keep loading state true after successful OAuth initiation', async () => {
    // Mock successful OAuth initiation
    mockSignInWithOAuth.mockResolvedValue({ error: null });

    render(
      <AuthProvider>
        <RegisterPage />
      </AuthProvider>
    );

    // Check the required checkboxes first
    const ageCheckbox = screen.getByLabelText(/i am 18 years or older/i);
    const termsCheckbox = screen.getByLabelText(/i agree to the terms/i);

    fireEvent.click(ageCheckbox);
    fireEvent.click(termsCheckbox);

    // Find the Google sign-up button
    const googleButton = screen.getByRole('button', { name: /sign up with google/i });

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
        <RegisterPage />
      </AuthProvider>
    );

    // Check the required checkboxes first
    const ageCheckbox = screen.getByLabelText(/i am 18 years or older/i);
    const termsCheckbox = screen.getByLabelText(/i agree to the terms/i);

    fireEvent.click(ageCheckbox);
    fireEvent.click(termsCheckbox);

    const googleButton = screen.getByRole('button', { name: /sign up with google/i });

    fireEvent.click(googleButton);

    // Wait for error to be shown
    await waitFor(() => {
      expect(screen.getByText(/oauth failed/i)).toBeInTheDocument();
    });

    // Button should be back to normal state
    expect(googleButton).toHaveTextContent(/sign up with google/i);
  });
});
