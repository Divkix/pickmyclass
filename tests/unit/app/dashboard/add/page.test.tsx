import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import AddClassPage from '@/app/dashboard/add/page';

const { mockCapture, mockPush, mockReplace } = vi.hoisted(() => ({
  mockCapture: vi.fn(),
  mockPush: vi.fn(),
  mockReplace: vi.fn(),
}));

vi.mock('posthog-js', () => ({ default: { capture: mockCapture } }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    replace: mockReplace,
    push: mockPush,
  }),
}));

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock('lucide-react', () => ({
  ArrowLeft: () => <span data-testid="arrow-left-icon">ArrowLeft</span>,
}));

const mockUseAuth = vi.fn();

vi.mock('@/lib/contexts/AuthContext', () => ({
  useAuth: () => mockUseAuth(),
}));

vi.mock('@/components/Header', () => ({
  Header: () => <header data-testid="header">Header</header>,
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({ children }: { children: React.ReactNode }) => (
    <button type="button">{children}</button>
  ),
}));

vi.mock('@/components/ui/skeleton', () => ({
  Skeleton: () => <div data-testid="skeleton">Skeleton</div>,
}));

vi.mock('@/components/AddClassWatch', () => ({
  AddClassWatch: ({
    onCreated,
  }: {
    onCreated: (watch: { id: string }, input: { term: string; class_nbr: string }) => void;
  }) => (
    <button
      type="button"
      onClick={() => onCreated({ id: 'watch-1' }, { term: '2267', class_nbr: '12345' })}
    >
      Submit watch
    </button>
  ),
}));

describe('AddClassPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseAuth.mockReturnValue({
      user: { id: 'user-1', email: 'student@example.com' },
      loading: false,
    });
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
    });
  });

  it('renders loading skeletons while auth is checking', () => {
    mockUseAuth.mockReturnValue({
      user: null,
      loading: true,
    });

    render(<AddClassPage />);

    expect(screen.getByTestId('header')).toBeInTheDocument();
    expect(screen.getAllByTestId('skeleton')).toHaveLength(2);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('redirects unauthenticated users to login', async () => {
    mockUseAuth.mockReturnValue({
      user: null,
      loading: false,
    });

    const { container } = render(<AddClassPage />);

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/login');
    });
    expect(container).toBeEmptyDOMElement();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('captures the created watch and returns to dashboard', async () => {
    render(<AddClassPage />);

    expect(screen.getByRole('link', { name: /back to dashboard/i })).toHaveAttribute(
      'href',
      '/dashboard'
    );
    fireEvent.click(screen.getByRole('button', { name: /submit watch/i }));

    await waitFor(() => {
      expect(mockCapture).toHaveBeenCalledWith('class_watch_added', {
        term: '2267',
        class_nbr: '12345',
      });
      expect(mockPush).toHaveBeenCalledWith('/dashboard');
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
