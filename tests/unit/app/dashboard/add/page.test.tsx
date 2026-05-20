import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AddClassPage from '@/app/dashboard/add/page';

const mockReplace = vi.fn();
const mockPush = vi.fn();

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
    onAdd,
  }: {
    onAdd: (watch: { term: string; class_nbr: string }) => Promise<void>;
  }) => {
    const [error, setError] = useState<string | null>(null);
    return (
      <div>
        <button
          type="button"
          onClick={() =>
            void onAdd({ term: '2267', class_nbr: '12345' }).catch((err: unknown) => {
              setError(err instanceof Error ? err.message : 'unknown error');
            })
          }
        >
          Submit watch
        </button>
        {error && <p role="alert">{error}</p>}
      </div>
    );
  },
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

  it('posts the new watch and returns to dashboard', async () => {
    render(<AddClassPage />);

    expect(screen.getByRole('link', { name: /back to dashboard/i })).toHaveAttribute(
      'href',
      '/dashboard'
    );
    fireEvent.click(screen.getByRole('button', { name: /submit watch/i }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/class-watches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ term: '2267', class_nbr: '12345' }),
      });
      expect(mockPush).toHaveBeenCalledWith('/dashboard');
    });
  });

  it('surfaces API errors from the add-watch request', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ error: 'Class already watched' }),
    });

    render(<AddClassPage />);
    fireEvent.click(screen.getByRole('button', { name: /submit watch/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Class already watched');
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('uses the fallback add-watch error when the response has no message', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({}),
    });

    render(<AddClassPage />);
    fireEvent.click(screen.getByRole('button', { name: /submit watch/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to add class watch');
    expect(mockPush).not.toHaveBeenCalled();
  });
});
