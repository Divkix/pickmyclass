import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test';
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
    global.fetch = vi.fn();
  });

  function renderLoginPage() {
    render(
      <AuthProvider>
        <LoginPage />
      </AuthProvider>
    );
  }

  function loginForm(): HTMLFormElement {
    const submitButton = screen
      .getAllByRole('button', { name: /^sign in$/i })
      .find((button) => button.getAttribute('type') === 'submit');
    return submitButton?.closest('form') as HTMLFormElement;
  }

  it('should keep loading state true after successful OAuth initiation', async () => {
    // Mock successful OAuth initiation
    mockSignInWithOAuth.mockResolvedValue({ error: null });

    renderLoginPage();

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

    renderLoginPage();

    const googleButton = screen.getByRole('button', { name: /sign in with google/i });

    fireEvent.click(googleButton);

    // Wait for error to be shown
    await waitFor(() => {
      expect(screen.getByText(/oauth failed/i)).toBeInTheDocument();
    });

    // Button should be back to normal state
    expect(googleButton).toHaveTextContent(/sign in with google/i);
  });

  it('validates missing login credentials before calling the API', async () => {
    renderLoginPage();

    fireEvent.submit(loginForm());

    expect(await screen.findByText('Email and password are required')).toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('shows lockout, remaining-attempts, and generic login errors', async () => {
    renderLoginPage();

    fireEvent.change(screen.getByLabelText(/email address/i), {
      target: { value: 'student@example.com' },
    });
    fireEvent.change(screen.getByLabelText(/^password$/i), {
      target: { value: 'wrong-password' },
    });

    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: false,
      status: 423,
      json: () =>
        Promise.resolve({ success: false, error: 'Locked', details: { remainingMinutes: 1 } }),
    } as Response);
    fireEvent.submit(loginForm());
    expect(await screen.findByText(/Please try again in 1 minute\./i)).toBeInTheDocument();

    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: () =>
        Promise.resolve({
          success: false,
          error: 'Invalid email or password',
          details: { remainingAttempts: 2 },
        }),
    } as Response);
    fireEvent.submit(loginForm());
    expect(await screen.findByText(/2 attempts remaining/i)).toBeInTheDocument();

    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: () => Promise.resolve({ error: 'Bad credentials' }),
    } as Response);
    fireEvent.submit(loginForm());
    expect(await screen.findByText('Bad credentials')).toBeInTheDocument();
  });

  it('shows an unexpected login error when the request throws', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    renderLoginPage();

    fireEvent.change(screen.getByLabelText(/email address/i), {
      target: { value: 'student@example.com' },
    });
    fireEvent.change(screen.getByLabelText(/^password$/i), {
      target: { value: 'wrong-password' },
    });

    vi.mocked(global.fetch).mockRejectedValueOnce(new Error('network down'));
    fireEvent.submit(loginForm());

    expect(
      await screen.findByText('An unexpected error occurred. Please try again.')
    ).toBeInTheDocument();
    errorSpy.mockRestore();
  });
});
