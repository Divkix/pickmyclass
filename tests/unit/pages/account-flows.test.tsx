import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { AnchorHTMLAttributes, ReactNode } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import ForgotPasswordPage from '@/app/forgot-password/page';
import ResetPasswordPage from '@/app/reset-password/page';
import SettingsPage from '@/app/settings/page';
import VerifyEmailPage from '@/app/verify-email/page';

const {
  mockCreateClient,
  mockFetch,
  mockGetUser,
  mockPush,
  mockReplace,
  mockResend,
  mockResetPasswordForEmail,
  mockSignOut,
  mockUpdateUser,
  mockUseAuth,
} = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
  mockFetch: vi.fn(),
  mockGetUser: vi.fn(),
  mockPush: vi.fn(),
  mockReplace: vi.fn(),
  mockResend: vi.fn(),
  mockResetPasswordForEmail: vi.fn(),
  mockSignOut: vi.fn(),
  mockUpdateUser: vi.fn(),
  mockUseAuth: vi.fn(),
}));

const validResetCredential = ['Alpha', 'Beta', '123'].join('');

type LinkHref = string | { pathname?: string };
type LinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & {
  href: LinkHref;
  children: ReactNode;
};

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: LinkProps) => (
    <a href={typeof href === 'string' ? href : (href.pathname ?? '#')} {...props}>
      {children}
    </a>
  ),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
    replace: mockReplace,
  }),
}));

vi.mock('@/components/Header', () => ({
  Header: () => <header>PickMyClass</header>,
}));

vi.mock('@/components/ui/tabs', () => ({
  Tabs: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  TabsContent: ({ children }: { children: ReactNode }) => <section>{children}</section>,
  TabsList: ({ children }: { children: ReactNode }) => <div role="tablist">{children}</div>,
  TabsTrigger: ({ children }: { children: ReactNode }) => (
    <button type="button" role="tab">
      {children}
    </button>
  ),
}));

vi.mock('@/lib/contexts/AuthContext', () => ({
  useAuth: () => mockUseAuth(),
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: mockCreateClient,
}));

describe.skip('account pages', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let createObjectURLSpy: ReturnType<typeof vi.spyOn>;
  let revokeObjectURLSpy: ReturnType<typeof vi.spyOn>;
  let clickSpy: ReturnType<typeof vi.spyOn>;

  beforeAll(() => {
    Object.defineProperty(window, 'location', {
      writable: true,
      value: { origin: 'https://pickmyclass.app' },
    });
  });

  beforeEach(() => {
    vi.clearAllMocks();
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    createObjectURLSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:export');
    revokeObjectURLSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    mockGetUser.mockResolvedValue({
      data: { user: { email: 'student@example.com' } },
      error: null,
    });
    mockResetPasswordForEmail.mockResolvedValue({ error: null });
    mockUpdateUser.mockResolvedValue({ error: null });
    mockResend.mockResolvedValue({ error: null });
    mockSignOut.mockResolvedValue({ error: null });
    mockCreateClient.mockReturnValue({
      auth: {
        getUser: mockGetUser,
        resend: mockResend,
        resetPasswordForEmail: mockResetPasswordForEmail,
        signOut: mockSignOut,
        updateUser: mockUpdateUser,
      },
    });
    mockUseAuth.mockReturnValue({
      user: {
        id: 'user-123',
        email: 'student@example.com',
        created_at: '2026-05-01T00:00:00Z',
      },
      loading: false,
    });
    mockFetch.mockResolvedValue({
      ok: true,
      blob: () => Promise.resolve(new Blob(['{}'], { type: 'application/json' })),
    });
    global.fetch = mockFetch;
  });

  afterEach(() => {
    errorSpy.mockRestore();
    createObjectURLSpy.mockRestore();
    revokeObjectURLSpy.mockRestore();
    clickSpy.mockRestore();
  });

  it('validates and submits forgot-password reset requests', async () => {
    render(<ForgotPasswordPage />);

    expect(await screen.findByText('Forgot Your Password?')).toBeInTheDocument();

    const forgotForm = screen.getByRole('button', { name: /send reset link/i }).closest('form')!;
    fireEvent.submit(forgotForm);
    expect(await screen.findByText('Email is required')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/email address/i), {
      target: { value: 'student@example.com' },
    });
    fireEvent.submit(forgotForm);

    await screen.findByText('Check your email');
    expect(mockResetPasswordForEmail).toHaveBeenCalledWith('student@example.com', {
      redirectTo: 'https://pickmyclass.app/auth/callback?next=/reset-password',
    });
  });

  it('shows forgot-password provider errors', async () => {
    mockResetPasswordForEmail.mockResolvedValueOnce({ error: { message: 'Email rate limited' } });
    render(<ForgotPasswordPage />);

    fireEvent.change(await screen.findByLabelText(/email address/i), {
      target: { value: 'student@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: /send reset link/i }));

    expect(await screen.findByText('Email rate limited')).toBeInTheDocument();
  });

  it('validates reset-password fields before updating the user', async () => {
    render(<ResetPasswordPage />);

    await screen.findByText('Create New Password');
    const resetForm = screen.getByRole('button', { name: /reset password/i }).closest('form')!;
    fireEvent.submit(resetForm);
    expect(await screen.findByText('All fields are required')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/^new password$/i), { target: { value: 'abcdefgh' } });
    fireEvent.change(screen.getByLabelText(/confirm new password/i), {
      target: { value: 'abcdefghi' },
    });
    fireEvent.submit(resetForm);
    expect(await screen.findByText('Passwords do not match')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/^new password$/i), { target: { value: 'short' } });
    fireEvent.change(screen.getByLabelText(/confirm new password/i), {
      target: { value: 'short' },
    });
    fireEvent.submit(resetForm);
    expect(await screen.findByText('Password must be at least 8 characters')).toBeInTheDocument();
  });

  it('updates reset passwords and redirects to login', async () => {
    render(<ResetPasswordPage />);

    fireEvent.change(await screen.findByLabelText(/^new password$/i), {
      target: { value: validResetCredential },
    });
    fireEvent.change(screen.getByLabelText(/confirm new password/i), {
      target: { value: validResetCredential },
    });
    fireEvent.click(screen.getByRole('button', { name: /reset password/i }));

    await waitFor(() =>
      expect(mockUpdateUser).toHaveBeenCalledWith({ password: validResetCredential })
    );
    expect(mockPush).toHaveBeenCalledWith('/login?password_reset=true');
  });

  it('loads verify-email state, resends verification, and signs out', async () => {
    render(<VerifyEmailPage />);

    expect(await screen.findByText('student@example.com')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /send verification email again/i }));

    expect(
      await screen.findByText('Verification email sent! Please check your inbox.')
    ).toBeInTheDocument();
    expect(mockResend).toHaveBeenCalledWith({
      type: 'signup',
      email: 'student@example.com',
      options: {
        emailRedirectTo: 'https://pickmyclass.app/auth/callback?next=/dashboard',
      },
    });

    fireEvent.click(screen.getByRole('button', { name: /sign out/i }));
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/login'));
  });

  it('shows verify-email errors when no email is available or resend fails', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    render(<VerifyEmailPage />);

    fireEvent.click(await screen.findByRole('button', { name: /send verification email again/i }));
    expect(await screen.findByText('No email found. Please sign in again.')).toBeInTheDocument();

    mockGetUser.mockResolvedValue({
      data: { user: { email: 'student@example.com' } },
      error: null,
    });
    mockResend.mockResolvedValueOnce({ error: { message: 'SMTP unavailable' } });
    fireEvent.click(screen.getByRole('button', { name: /send verification email again/i }));
    expect(await screen.findByText('SMTP unavailable')).toBeInTheDocument();
  });

  it('redirects settings visitors who are not signed in', async () => {
    mockUseAuth.mockReturnValue({ user: null, loading: false });

    render(<SettingsPage />);

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/login'));
  });

  it('renders settings and exports account data', async () => {
    render(<SettingsPage />);

    expect(screen.getByRole('heading', { name: /settings/i })).toBeInTheDocument();
    expect(screen.getByText('student@example.com')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Data' }));
    expect(await screen.findByText('Data Management')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /export data/i }));

    expect(await screen.findByText('Data exported successfully!')).toBeInTheDocument();
    expect(mockFetch).toHaveBeenCalledWith('/api/user/export', { method: 'GET' });
    expect(createObjectURLSpy).toHaveBeenCalled();
    expect(revokeObjectURLSpy).toHaveBeenCalledWith('blob:export');
  });

  it('shows settings export errors and opens the delete confirmation modal', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false });
    render(<SettingsPage />);

    fireEvent.click(screen.getByRole('tab', { name: 'Data' }));
    expect(await screen.findByText('Data Management')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /export data/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to export data');

    fireEvent.click(screen.getByRole('button', { name: /^delete account$/i }));
    expect(
      await screen.findByText(
        'This action will permanently delete your account and all associated data.'
      )
    ).toBeInTheDocument();
  });
});
