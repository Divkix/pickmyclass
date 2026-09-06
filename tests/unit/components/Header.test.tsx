import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import { Header } from '@/components/Header';

interface AuthState {
  user: { id: string; email: string | null } | null;
  session: { id: string } | null;
  loading: boolean;
}

const h: { authState: AuthState } = vi.hoisted(() => ({
  authState: {
    user: null,
    session: null,
    loading: false,
  },
}));

vi.mock('@/lib/contexts/AuthContext', () => ({
  useAuth: () => h.authState,
}));

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" {...rest}>
      {children}
    </button>
  ),
}));

vi.mock('@/components/Logo', () => ({
  Logo: () => <span data-testid="logo">PickMyClass</span>,
}));

vi.mock('@/components/ThemeToggle', () => ({
  ThemeToggle: () => <button type="button" aria-label="Toggle theme" />,
}));

vi.mock('@/components/AuthButton', () => ({
  AuthButton: () => <div data-testid="auth-button" />,
}));

vi.mock('lucide-react', () => ({
  LayoutDashboard: () => <span data-testid="layout-dashboard-icon" />,
  Shield: () => <span data-testid="shield-icon" />,
  Menu: () => <span data-testid="menu-icon" />,
  X: () => <span data-testid="x-icon" />,
}));

describe('Header', () => {
  beforeEach(() => {
    h.authState = {
      user: { id: 'user-1', email: 'student@example.com' },
      session: { id: 'sess_test' },
      loading: false,
    };
  });

  it('routes a signed-in user to the dashboard without surfacing admin UI', () => {
    render(<Header />);

    expect(screen.getByRole('button', { name: 'Go to dashboard' }).closest('a')).toHaveAttribute(
      'href',
      '/dashboard'
    );
    expect(screen.queryByRole('link', { name: /admin/i })).not.toBeInTheDocument();
  });

  it('omits the account nav link while signed out or loading', () => {
    h.authState = { user: null, session: null, loading: true };
    const { unmount } = render(<Header />);
    expect(screen.queryByRole('link', { name: /dashboard|admin/i })).not.toBeInTheDocument();
    unmount();

    h.authState = { user: null, session: null, loading: false };
    render(<Header />);
    expect(screen.queryByRole('link', { name: /dashboard|admin/i })).not.toBeInTheDocument();
  });
});
