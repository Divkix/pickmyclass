import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import RegisterPage from '@/app/register/page';
import { AuthProvider } from '@/lib/contexts/AuthContext';

// Mock the supabase client module
const mockSignInWithOAuth = vi.fn();
const mockRpc = vi.fn();
const mockSupabaseClient = {
  auth: {
    signInWithOAuth: mockSignInWithOAuth,
    getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }),
    getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
    onAuthStateChange: vi.fn().mockReturnValue({
      data: { subscription: { unsubscribe: vi.fn() } },
    }),
  },
  rpc: mockRpc,
};

const validRegistrationCredential = ['Alpha', 'Beta', '123'].join('');

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => mockSupabaseClient,
}));

// Mock next/navigation
const mockPush = vi.fn();
const mockReplace = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace }),
  useSearchParams: () => new URLSearchParams(),
}));

describe('RegisterPage - Google OAuth loading state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSignInWithOAuth.mockReset();
    mockRpc.mockReset();
    mockRpc.mockResolvedValue({ error: null });
    global.fetch = vi.fn();
  });

  function renderRegisterPage() {
    render(
      <AuthProvider>
        <RegisterPage />
      </AuthProvider>
    );
  }

  async function waitForRegisterForm() {
    await screen.findByText('Get Started');
  }

  function registerForm(): HTMLFormElement {
    // SAFETY: rendered register page always contains create-account button inside a form
    return screen
      .getByRole('button', { name: /create account/i })
      .closest('form') as HTMLFormElement;
  }

  function fillRegistrationForm({
    email = 'student@example.com',
    password = validRegistrationCredential,
    confirmPassword,
    age = true,
    terms = true,
  }: {
    email?: string;
    password?: string;
    confirmPassword?: string;
    age?: boolean;
    terms?: boolean;
  } = {}) {
    fireEvent.change(screen.getByLabelText(/email address/i), { target: { value: email } });
    fireEvent.change(screen.getByLabelText(/^password$/i), { target: { value: password } });
    fireEvent.change(screen.getByLabelText(/confirm password/i), {
      target: { value: confirmPassword ?? password },
    });
    if (age) fireEvent.click(screen.getByLabelText(/i am 18 years or older/i));
    if (terms) fireEvent.click(screen.getByLabelText(/i agree to the terms/i));
  }

  it('should keep loading state true after successful OAuth initiation', async () => {
    // Mock successful OAuth initiation
    mockSignInWithOAuth.mockResolvedValue({ error: null });

    renderRegisterPage();
    await waitForRegisterForm();

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
      expect(mockSignInWithOAuth).toHaveBeenCalledWith({
        provider: 'google',
        options: {
          redirectTo: 'http://localhost:3000/auth/callback?consent=confirmed&next=/dashboard',
        },
      });
    });

    // The button should still be in loading state because
    // successful OAuth doesn't reset loading (browser will navigate away)
    expect(googleButton).toHaveTextContent(/redirecting to google/i);
  });

  it('should reset loading state on OAuth error', async () => {
    // Mock OAuth error
    mockSignInWithOAuth.mockResolvedValue({ error: { message: 'OAuth failed' } });

    renderRegisterPage();
    await waitForRegisterForm();

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

  it('validates email registration fields before calling the API', async () => {
    renderRegisterPage();
    await waitForRegisterForm();

    fireEvent.submit(registerForm());
    expect(await screen.findByText('All fields are required')).toBeInTheDocument();

    fillRegistrationForm({ age: false, terms: false });
    fireEvent.submit(registerForm());
    expect(
      await screen.findByText('You must be 18 years or older to use this service')
    ).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText(/i am 18 years or older/i));
    fireEvent.submit(registerForm());
    expect(
      await screen.findByText('You must agree to the Terms of Service and Privacy Policy')
    ).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText(/i agree to the terms/i));
    fireEvent.change(screen.getByLabelText(/confirm password/i), {
      target: { value: 'DifferentP@ss1' },
    });
    fireEvent.submit(registerForm());
    expect(await screen.findByText('Passwords do not match')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/^password$/i), { target: { value: 'short' } });
    fireEvent.change(screen.getByLabelText(/confirm password/i), { target: { value: 'short' } });
    fireEvent.submit(registerForm());
    expect(await screen.findByText('Password must be at least 8 characters')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/^password$/i), { target: { value: 'abcdefgh' } });
    fireEvent.change(screen.getByLabelText(/confirm password/i), { target: { value: 'abcdefgh' } });
    fireEvent.submit(registerForm());
    expect(
      await screen.findByText('Password is too weak. Please use a stronger password.')
    ).toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('registers email users with consent metadata and routes to verification', async () => {
    // SAFETY: test fetch mock only needs ok/json subset of Response
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ success: true }),
    } as Response);
    renderRegisterPage();
    await waitForRegisterForm();

    fillRegistrationForm();
    fireEvent.submit(registerForm());

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'student@example.com',
          password: validRegistrationCredential,
          ageVerified: true,
          agreedToTerms: true,
        }),
      });
    });
    // Consent is persisted server-side via the signup trigger; no client RPC.
    expect(mockRpc).not.toHaveBeenCalled();
    expect(mockPush).toHaveBeenCalledWith('/verify-email');
  });

  it('shows registration API and duplicate-account errors', async () => {
    // SAFETY: test fetch mock only needs ok/json subset of Response
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: false,
      json: () => Promise.resolve({ error: 'Disposable email not accepted' }),
    } as Response);
    renderRegisterPage();
    await waitForRegisterForm();

    fillRegistrationForm();
    fireEvent.submit(registerForm());
    expect(await screen.findByText('Disposable email not accepted')).toBeInTheDocument();

    // The register API returns 409 for duplicates (never 200 + details.duplicate),
    // so the client surfaces the server-provided error message via the non-ok branch.
    // SAFETY: test fetch mock only needs ok/status/json subset of Response
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: false,
      status: 409,
      json: () => Promise.resolve({ error: 'This email is already registered. Please sign in.' }),
    } as Response);
    fireEvent.submit(registerForm());
    expect(
      await screen.findByText('This email is already registered. Please sign in.')
    ).toBeInTheDocument();
  });

  it('reports unexpected registration failures', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    renderRegisterPage();
    await waitForRegisterForm();

    fillRegistrationForm();
    vi.mocked(global.fetch).mockRejectedValueOnce(new Error('network down'));
    fireEvent.submit(registerForm());
    expect(await screen.findByText('An unexpected error occurred')).toBeInTheDocument();
    errorSpy.mockRestore();
  });

  it('validates Google signup preconditions and handles initiation failures', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    renderRegisterPage();
    await waitForRegisterForm();

    const googleButton = screen.getByRole('button', { name: /sign up with google/i });
    fireEvent.click(googleButton);
    expect(
      await screen.findByText('You must be 18 years or older to use this service')
    ).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText(/i am 18 years or older/i));
    fireEvent.click(googleButton);
    expect(
      await screen.findByText('You must agree to the Terms of Service and Privacy Policy')
    ).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText(/i agree to the terms/i));
    mockSignInWithOAuth.mockRejectedValueOnce(new Error('oauth unavailable'));
    fireEvent.click(googleButton);
    expect(await screen.findByText('Failed to initiate Google sign-up')).toBeInTheDocument();
    errorSpy.mockRestore();
  });
});
